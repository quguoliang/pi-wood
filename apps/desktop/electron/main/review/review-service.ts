import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SdkAdapter } from "@pi-wood/engine/sdk";
import { reinjectProviderEnv } from "../provider/provider-manager";
import { pickAuxModel } from "../provider/model-pick";
import { loadSettings } from "../settings-service";
import { permissionGateExtension } from "../security/approval-gate";
import type { Finding } from "@pi-wood/ipc-schema";
import { buildReviewPrompt, parseFindings } from "./parse-findings.ts";

/**
 * T7.7 代码审查的一次性 LLM 调用：与主会话隔离的第二运行时（temp cwd、denyAll 门、空工具、纯文本），
 * 选模型优先小模型 smallModel（复用 pickAuxModel）。单次生成、超时兜底；失败/超时 → findings 空 + error。
 * 仿 T7.9/T7.5 的隔离运行时，各自独立单例避免相互打断。
 */
const REVIEW_TTL_MS = 60_000; // diff 审查可能较长

let adapter: SdkAdapter | undefined;
let starting: Promise<SdkAdapter> | undefined;
let inFlight = false;
let buf = "";
let resolveCurrent: ((raw: string) => void) | null = null;

function onReviewEvent(e: Record<string, unknown>): void {
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

function reviewCwd(): string {
  const dir = join(tmpdir(), "pi-wood-review");
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
      projectDir: reviewCwd(),
      uiBridge: { notify: () => {}, select: async () => undefined, confirm: async () => false, input: async () => undefined },
      customTools: [],
      inlineExtensions: [permissionGateExtension(() => ({ mode: "denyAll", rules: [] }), async () => false)],
    });
    try {
      const models = await next.getAvailableModels();
      const s = loadSettings();
      const picked = pickAuxModel(models, s.smallModel, s.model);
      if (picked) await next.setModel(picked.provider, picked.id);
    } catch {
      /* SDK 默认模型 */
    }
    next.subscribe((e) => onReviewEvent(e as unknown as Record<string, unknown>));
    adapter = next;
    return next;
  })();
  try {
    return await starting;
  } finally {
    starting = undefined;
  }
}

export interface ReviewOutcome {
  findings: Finding[];
  error?: string;
}

/** 对 diff 文本跑一次审查。并发单飞（同刻仅一个审查）；忙时返回 busy。 */
export async function runReview(diffText: string): Promise<ReviewOutcome> {
  if (inFlight) return { findings: [], error: "已有一次审查在进行中，请稍候" };
  inFlight = true;
  try {
    const ad = await ensureAdapter();
    await ad.newSession();
    buf = "";
    const done = new Promise<string>((resolve) => {
      resolveCurrent = resolve;
    });
    const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(""), REVIEW_TTL_MS));
    void ad.prompt({ text: buildReviewPrompt(diffText) }).catch(() => undefined);
    const raw = await Promise.race([done, timeout]);
    resolveCurrent = null;
    buf = "";
    if (!raw.trim()) return { findings: [], error: "审查模型未返回内容（可能超时）" };
    return { findings: parseFindings(raw) };
  } catch (e) {
    return { findings: [], error: e instanceof Error ? e.message : String(e) };
  } finally {
    inFlight = false;
  }
}
