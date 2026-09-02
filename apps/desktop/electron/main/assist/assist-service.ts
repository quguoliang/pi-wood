import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SdkAdapter } from "@pi-wood/engine/sdk";
import { reinjectProviderEnv } from "../provider/provider-manager";
import { loadSettings } from "../settings-service";
import { permissionGateExtension } from "../security/approval-gate";
import { type AssistResult, shouldAssist, buildAssistPrompt, parseAssist } from "./assist-parse";

export type { AssistResult } from "./assist-parse";

/**
 * T7.9 会话辅助（Session Assist）：每轮助手回复 settled 后，用**隔离的轻量运行时**生成
 * 简短回顾 + 1~3 条建议追问。为不污染左栏会话列表，辅助 SdkAdapter 的 projectDir 用系统临时目录
 * （会话按 cwd 归集，不会出现在真实项目的 sessionsList 中）；注入 denyAll 审批门 + 空工具，纯文本。
 * 复用当前已配置模型（尚无独立小模型设置），单次生成、带超时与单飞锁，任何失败降级为无辅助。
 */
const ASSIST_TTL_MS = 25_000;

let adapter: SdkAdapter | undefined;
let starting: Promise<SdkAdapter> | undefined;
let inFlight = false;

let buf = "";
let resolveCurrent: ((raw: string) => void) | null = null;

function onAssistEvent(e: Record<string, unknown>): void {
  if (e.type === "message_update") {
    const a = e.assistantMessageEvent as { type?: string; delta?: unknown } | undefined;
    if (a?.type === "text_delta" && typeof a.delta === "string") buf += a.delta;
    return;
  }
  if (e.type === "agent_end" || e.type === "agent_settled") {
    if (resolveCurrent) {
      const raw = buf;
      buf = "";
      const res = resolveCurrent;
      resolveCurrent = null;
      res(raw);
    }
  }
}

function assistCwd(): string {
  const dir = join(tmpdir(), "pi-wood-assist");
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function ensureAdapter(): Promise<SdkAdapter> {
  if (adapter) return adapter;
  if (starting) return starting;
  reinjectProviderEnv();
  starting = (async () => {
    const next = new SdkAdapter();
    await next.start({
      projectDir: assistCwd(),
      uiBridge: { notify: () => {}, select: async () => undefined, confirm: async () => false, input: async () => undefined },
      customTools: [],
      inlineExtensions: [permissionGateExtension(() => ({ mode: "denyAll", rules: [] }), async () => false)],
    });
    try {
      const models = await next.getAvailableModels();
      const pref = loadSettings().model as { provider?: string; id?: string } | undefined;
      const picked =
        pref?.provider && pref.id && models.some((m) => m.provider === pref.provider && m.id === pref.id)
          ? { provider: pref.provider, id: pref.id }
          : models[0];
      if (picked) await next.setModel(picked.provider, picked.id);
    } catch {
      /* 交给 SDK 默认模型 */
    }
    next.subscribe((e) => onAssistEvent(e as unknown as Record<string, unknown>));
    adapter = next;
    return next;
  })();
  try {
    return await starting;
  } finally {
    starting = undefined;
  }
}

/** 生成一次辅助结果；并发/过短/失败均返回 null（引擎未就绪等异常安全吞掉）。 */
export async function generateAssist(userText: string, assistantText: string): Promise<AssistResult | null> {
  if (inFlight || !shouldAssist(assistantText)) return null;
  inFlight = true;
  try {
    const ad = await ensureAdapter();
    await ad.newSession(); // 每轮独立上下文，避免历史累积
    buf = "";
    const done = new Promise<string>((resolve) => {
      resolveCurrent = resolve;
    });
    const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(""), ASSIST_TTL_MS));
    void ad.prompt({ text: buildAssistPrompt(userText, assistantText) }).catch(() => undefined);
    const raw = await Promise.race([done, timeout]);
    resolveCurrent = null;
    buf = "";
    return parseAssist(raw);
  } catch {
    return null;
  } finally {
    inFlight = false;
  }
}
