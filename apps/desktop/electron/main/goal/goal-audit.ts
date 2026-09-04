import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SdkAdapter } from "@pi-wood/engine/sdk";
import { reinjectProviderEnv } from "../provider/provider-manager";
import { pickAuxModel } from "../provider/model-pick";
import { loadSettings } from "../settings-service";
import { permissionGateExtension } from "../security/approval-gate";
import { SlotGate } from "../engine/concurrency-gates";
import { buildAuditPrompt, parseAudit, type AuditResult } from "./goal-prompt.ts";

/**
 * T7.5 进度审计的小模型 one-shot（独立隔离运行时，不污染左栏会话列表：cwd 用系统临时目录、
 * denyAll 审批门 + 空工具、纯文本）。与 T7.9 会话辅助同款——各自独立单例避免相互打断。
 * 复用当前已配置模型（尚无独立小模型设置，见 §8 偏差）；失败/超时/不可解析一律返回 undefined。
 * T8.5：全局单飞改「排队而非吞掉」（原单飞把后到审计静默变 undefined，runtime 会误记「审计失败」）。
 * ⚠ 计划写「全局并发 ≤2」，但底层 adapter/buf/resolveCurrent 是共享单槽 ⇒ 实取 1（上界内）。
 */
const AUDIT_TTL_MS = 25_000;

let adapter: SdkAdapter | undefined;
let starting: Promise<SdkAdapter> | undefined;
const auditQueue = new SlotGate(1);
let buf = "";
let resolveCurrent: ((raw: string) => void) | null = null;

function onAuditEvent(e: Record<string, unknown>): void {
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

function auditCwd(): string {
  const dir = join(tmpdir(), "pi-wood-goal-audit");
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
      projectDir: auditCwd(),
      uiBridge: { notify: () => {}, select: async () => undefined, confirm: async () => false, input: async () => undefined },
      customTools: [],
      inlineExtensions: [permissionGateExtension(() => ({ mode: "denyAll", rules: [] }), async () => false)],
    });
    try {
      const models = await next.getAvailableModels();
      const s = loadSettings();
      // 目标审计优先用小模型（smallModel），未配置则沿用默认模型（见 model-pick 优先级）
      const picked = pickAuxModel(models, s.smallModel, s.model);
      if (picked) await next.setModel(picked.provider, picked.id);
    } catch {
      /* SDK 默认模型 */
    }
    next.subscribe((e) => onAuditEvent(e as unknown as Record<string, unknown>));
    adapter = next;
    return next;
  })();
  try {
    return await starting;
  } finally {
    starting = undefined;
  }
}

/** 跑一次审计；任何失败/超时/不可解析 → undefined（runtime 按「审计失败」计数处理）。并发时排队。 */
export async function auditGoal(objective: string, lastAssistant: string): Promise<AuditResult | undefined> {
  await auditQueue.acquire();
  try {
    const ad = await ensureAdapter();
    await ad.newSession();
    buf = "";
    const done = new Promise<string>((resolve) => {
      resolveCurrent = resolve;
    });
    const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(""), AUDIT_TTL_MS));
    void ad.prompt({ text: buildAuditPrompt(objective, lastAssistant) }).catch(() => undefined);
    const raw = await Promise.race([done, timeout]);
    resolveCurrent = null;
    buf = "";
    return parseAudit(raw);
  } catch {
    return undefined;
  } finally {
    auditQueue.release();
  }
}
