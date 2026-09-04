import { z } from "zod";
import { EngineCommandSchema, EngineEventSchema, PromptCommandSchema, SessionStateSchema } from "./engine.ts";

/**
 * 引擎子进程 RPC 帧契约（T8.1，方案 §7.9 D 方案）
 *
 * 主进程 ↔ utilityProcess(child) 之间**只有这一套帧**，与渲染层 IPC envelope（T8.2）是两层协议：
 * - `child → main`：本文件的上行帧（带 `seq`，供主进程对账丢帧/乱序）
 * - `main → renderer`：T8.2 的 envelope（按可见性二次聚合后推）
 *
 * 设计约束（踩过的坑都在这里有对应处置）：
 * 1. 帧必须可 `structuredClone`：只含纯数据，错误一律字符串化（Pi 的 Error 带不可克隆字段）。
 * 2. 高频 `event` 帧**不走 zod**：逐 token 校验在主进程是纯浪费（3 路并发可达数千帧/秒），
 *    故热路径用 `decodeFrameLoose()`（只做结构哨兵），`parseFrame()` 留给单测/开发期严格校验。
 * 3. `seq` 只由 child 自增、只对 `event` 有意义；**会话归属由主进程按 handle 附加**，
 *    不信任 child 自报的 conversationId（deny-by-default 的前置）。
 * 4. 反向调用（`invoke` 上行）是 child 借宿主能力的唯一通道：宿主工具执行、ctx.ui、审批裁决、
 *    策略读取。child 拿不到任何本地兜底放行路径。
 */

export const ENGINE_RPC_VERSION = 1;

// ---------- 方法名（唯一定义处，child 与 main 各自 switch 的取值域） ----------

/** 主进程 → child：驱动引擎的命令（与 EngineAdapter 方法一一对应） */
export const ENGINE_RPC_METHODS = [
  "start",
  "prompt",
  "steer",
  "followUp",
  "abort",
  "setModel",
  "setThinkingLevel",
  "getAvailableThinkingLevels",
  "getAvailableModels",
  "compact",
  "newSession",
  "switchSession",
  "fork",
  "reload",
  "getState",
  "getSessionId",
  "getRuntimeInfo",
  "listCommands",
  "stats",
  "shutdown",
] as const;
export type EngineRpcMethod = (typeof ENGINE_RPC_METHODS)[number];

/** child → 主进程：借用宿主能力的反向命令（⚠ 没有「把策略给 child 自己判」这条通道，见 host:approval） */
export const ENGINE_REVERSE_METHODS = [
  "host:tool-execute",
  "host:ui",
  "host:approval",
  "host:subagent",
] as const;
export type EngineReverseRpcMethod = (typeof ENGINE_REVERSE_METHODS)[number];

// ---------- 参数 / 返回值 ----------

export const EngineStartParamsSchema = z.object({
  /** 对话工作目录（T8.6 前 = 项目目录；之后 = 该对话的 worktree） */
  projectDir: z.string().min(1),
  agentDir: z.string().optional(),
  /** 工具名白名单由 child 生成代理工具时使用；宿主侧实现留在主进程 */
  hostToolNames: z.array(z.string().min(1)).default([]),
  additionalExtensionPaths: z.array(z.string().min(1)).default([]),
  /** 审批门档位快照（child 每次裁决前仍回查 host:policy，避免热更新后失配） */
  approvalMode: z.string().optional(),
});
export type EngineStartParams = z.infer<typeof EngineStartParamsSchema>;

export const EngineStartResultSchema = z.object({
  pid: z.number(),
  cwd: z.string(),
  agentDir: z.string(),
  sessionId: z.string(),
  sessionFile: z.string().optional(),
  tools: z.array(z.string()),
  extensionCount: z.number(),
  skills: z.array(z.string()),
  diagnostics: z.array(z.object({ type: z.string().optional(), message: z.string() })),
  timings: z.object({ sdkImportMs: z.number(), servicesMs: z.number(), sessionMs: z.number(), bindMs: z.number(), totalMs: z.number() }),
  memRssMB: z.number(),
});
export type EngineStartResult = z.infer<typeof EngineStartResultSchema>;

export const SetModelParamsSchema = z.object({ provider: z.string().min(1), modelId: z.string().min(1) });
export const SetThinkingParamsSchema = z.object({ level: z.string().min(1) });
export const SwitchSessionParamsSchema = z.object({ file: z.string().min(1) });
export const ForkParamsSchema = z.object({ entryId: z.string().min(1), position: z.enum(["before", "at"]) });
export const NewSessionParamsSchema = z.object({ parentSession: z.string().optional() });
export const CompactParamsSchema = z.object({ custom: z.string().optional() });
export const TextParamsSchema = z.object({ text: z.string() });
export const StatsParamsSchema = z.object({ tag: z.string().optional() });

/** 上行反向调用的参数 */
export const HostToolExecuteParamsSchema = z.object({
  name: z.string().min(1),
  toolCallId: z.string().optional(),
  params: z.unknown().optional(),
});
export type HostToolExecuteParams = z.infer<typeof HostToolExecuteParamsSchema>;
export const HostUiParamsSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("notify"), message: z.string(), type: z.enum(["info", "warning", "error"]).optional() }),
  z.object({ op: z.literal("select"), title: z.string(), options: z.array(z.string()) }),
  z.object({ op: z.literal("confirm"), title: z.string(), message: z.string() }),
  z.object({ op: z.literal("input"), title: z.string(), placeholder: z.string().optional() }),
]);
export type HostUiParams = z.infer<typeof HostUiParamsSchema>;
export const HostApprovalParamsSchema = z.object({
  /** child 侧的一次性票据：主进程应答时原样带回，防跨对话/重放飞批（T8.4 收紧） */
  ticket: z.string().min(1),
  toolName: z.string(),
  input: z.unknown().optional(),
  /** 子代理 child 的审批带 profile 名，用于 per-tool 覆盖（T6.7） */
  agentName: z.string().optional(),
});
export type HostApprovalParams = z.infer<typeof HostApprovalParamsSchema>;
/** 审批裁决回执：主进程是唯一裁决者，child 拿不到 allow 一律拒绝（deny-by-default） */
export const HostApprovalResultSchema = z.object({ allow: z.boolean(), reason: z.string().optional() });
export type HostApprovalResult = z.infer<typeof HostApprovalResultSchema>;
/** 宿主工具执行回执（形状对齐 Pi ToolResult：content 数组 + details） */
export const HostToolResultSchema = z.object({
  content: z.array(z.unknown()),
  details: z.unknown().optional(),
});
export type HostToolResult = z.infer<typeof HostToolResultSchema>;
export const HostSubagentParamsSchema = z.discriminatedUnion("op", [
  /** ticket：与 host:approval 同款一次性票据，主进程消费防重放（T8.4 收紧） */
  z.object({ op: z.literal("guard-tool"), ticket: z.string().min(1).optional(), toolName: z.string(), input: z.unknown().optional(), agentName: z.string().optional() }),
  z.object({ op: z.literal("runs"), runs: z.array(z.unknown()) }),
  z.object({ op: z.literal("child-event"), runId: z.string(), event: z.unknown() }),
]);
export type HostSubagentParams = z.infer<typeof HostSubagentParamsSchema>;

// ---------- 帧 ----------

const InvokeDown = z.object({
  v: z.literal(ENGINE_RPC_VERSION).default(ENGINE_RPC_VERSION),
  kind: z.literal("invoke"),
  id: z.number().int().nonnegative(),
  method: z.enum(ENGINE_RPC_METHODS),
  params: z.unknown().optional(),
});
const RespondFrame = z.object({
  v: z.literal(ENGINE_RPC_VERSION).default(ENGINE_RPC_VERSION),
  kind: z.literal("respond"),
  id: z.number().int().nonnegative(),
  ok: z.boolean(),
  value: z.unknown().optional(),
  /** 一律字符串：Error 对象不可 structuredClone（且跨进程无意义） */
  error: z.string().optional(),
});
const InvokeUp = InvokeDown.extend({ method: z.enum(ENGINE_REVERSE_METHODS) });
const EventUp = z.object({
  v: z.literal(ENGINE_RPC_VERSION).default(ENGINE_RPC_VERSION),
  kind: z.literal("event"),
  seq: z.number().int().nonnegative(),
  event: EngineEventSchema,
});
const HelloUp = z.object({
  v: z.literal(ENGINE_RPC_VERSION).default(ENGINE_RPC_VERSION),
  kind: z.literal("hello"),
  pid: z.number().int(),
  protocol: z.number().int(),
  node: z.string(),
  electron: z.string().optional(),
});
const ByeUp = z.object({
  v: z.literal(ENGINE_RPC_VERSION).default(ENGINE_RPC_VERSION),
  kind: z.literal("bye"),
  reason: z.string(),
});
const LogUp = z.object({
  v: z.literal(ENGINE_RPC_VERSION).default(ENGINE_RPC_VERSION),
  kind: z.literal("log"),
  level: z.enum(["info", "warn", "error"]),
  text: z.string(),
});
const CancelDown = z.object({
  v: z.literal(ENGINE_RPC_VERSION).default(ENGINE_RPC_VERSION),
  kind: z.literal("cancel"),
  id: z.number().int().nonnegative(),
});
const ShutdownDown = z.object({
  v: z.literal(ENGINE_RPC_VERSION).default(ENGINE_RPC_VERSION),
  kind: z.literal("shutdown"),
  id: z.number().int().nonnegative(),
  reason: z.enum(["suspend", "close", "quit"]).default("quit"),
});

export const RpcRespondFrameSchema = RespondFrame;

/** 下行帧（main → child） */
export const EngineDownFrameSchema = z.discriminatedUnion("kind", [InvokeDown, RespondFrame, CancelDown, ShutdownDown]);
/** 上行帧（child → main） */
export const EngineUpFrameSchema = z.discriminatedUnion("kind", [InvokeUp, RespondFrame, EventUp, HelloUp, ByeUp, LogUp]);

export type EngineDownFrame = z.infer<typeof EngineDownFrameSchema>;
export type EngineUpFrame = z.infer<typeof EngineUpFrameSchema>;
export type EngineInvokeDown = z.infer<typeof InvokeDown>;
export type EngineEventUp = z.infer<typeof EventUp>;

// ---------- 纯函数编解码（可 node --test 穷举） ----------

export interface FrameError {
  ok: false;
  error: string;
}
export type DecodeResult<T> = { ok: true; frame: T } | FrameError;

const asErr = (why: string, raw: unknown): FrameError => ({
  ok: false,
  error: `${why}（frame=${safePreview(raw)}）`,
});

function safePreview(raw: unknown): string {
  if (raw === null) return "null";
  if (typeof raw !== "object") return `${typeof raw}:${String(raw).slice(0, 60)}`;
  const o = raw as Record<string, unknown>;
  return `${typeof o.kind}/${typeof o.id}/${typeof o.seq}`;
}

/** 严格解码（单测 / 开发期）。热路径不要用——见 decodeFrameLoose。 */
export function decodeFrame<T>(schema: z.ZodType<T>, raw: unknown): DecodeResult<T> {
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, frame: parsed.data } : asErr(parsed.error.issues[0]?.message ?? "schema 不匹配", raw);
}

const ALLOWED_KINDS = new Set(["invoke", "respond", "event", "hello", "bye", "log", "cancel", "shutdown"]);

/**
 * 热路径解码：只做「能不能安全分发」的结构哨兵，不校验载荷。
 * 载荷字段缺失由消费侧（switch/可选链）兜住——宁可丢一帧的字段，也不因每 token 一次 zod 拖垮主进程。
 */
const isNonNegInt = (n: unknown): boolean => typeof n === "number" && Number.isInteger(n) && n >= 0;

export function decodeFrameLoose(raw: unknown): EngineUpFrame | EngineDownFrame | null {
  if (typeof raw !== "object" || raw === null) return null;
  const f = raw as Record<string, unknown>;
  if (typeof f.kind !== "string" || !ALLOWED_KINDS.has(f.kind)) return null;
  switch (f.kind) {
    case "invoke":
      if (!isNonNegInt(f.id) || typeof f.method !== "string") return null;
      break;
    case "respond":
      if (!isNonNegInt(f.id) || typeof f.ok !== "boolean") return null;
      break;
    case "event":
      if (!isNonNegInt(f.seq) || typeof f.event !== "object" || f.event === null) return null;
      break;
    case "cancel":
    case "shutdown":
      if (!isNonNegInt(f.id)) return null;
      break;
    default:
      break;
  }
  return f as unknown as EngineUpFrame | EngineDownFrame;
}

let frameSeq = 0;
/** 自增请求 id（0 保留给「无应答」帧，故从 1 起） */
export function nextFrameId(): number {
  frameSeq += 1;
  return frameSeq;
}
/** 测试可重置，保证断言可复现 */
export function resetFrameIdForTest(value = 0): void {
  frameSeq = value;
}

export function makeInvoke(method: EngineRpcMethod | EngineReverseRpcMethod, params?: unknown, id = nextFrameId()) {
  return { v: ENGINE_RPC_VERSION, kind: "invoke" as const, id, method, params };
}
export function makeRespond(id: number, ok: boolean, value?: unknown, error?: string) {
  return { v: ENGINE_RPC_VERSION, kind: "respond" as const, id, ok, value, error };
}
export function makeEvent(seq: number, event: unknown) {
  return { v: ENGINE_RPC_VERSION, kind: "event" as const, seq, event };
}

/** 把任意异常安全地翻成可克隆的错误字符串（child/main 两侧 respond 失败路径共用） */
export function frameErrorText(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  if (err === undefined) return "undefined";
  if (err === null) return "null";
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

/**
 * seq 对账（主进程侧）：返回该事件是否为「预期的下一帧」。
 * 丢帧不静默：调用方据此计数 + warn（T8.2 验收项）。
 */
export function acceptSeq(lastSeq: number, seq: number): { ok: boolean; dropped: number } {
  if (seq <= lastSeq) return { ok: false, dropped: 0 }; // 重复/乱序帧：丢弃但不断档
  return { ok: seq === lastSeq + 1, dropped: seq - lastSeq - 1 };
}

/** 状态回显用的类型守卫（渲染层不感知本文件，这里只给主进程/child 用） */
export const isEngineRpcMethod = (m: unknown): m is EngineRpcMethod =>
  typeof m === "string" && (ENGINE_RPC_METHODS as readonly string[]).includes(m);
export const isEngineReverseRpcMethod = (m: unknown): m is EngineReverseRpcMethod =>
  typeof m === "string" && (ENGINE_REVERSE_METHODS as readonly string[]).includes(m);

// ---------- 下行命令的入参校验表（child 侧消费；命令级频次，不在 token 热路径） ----------

const VOID_PARAMS = z.unknown();

export const ENGINE_RPC_PARAM_SCHEMAS: Record<EngineRpcMethod, z.ZodTypeAny> = {
  start: EngineStartParamsSchema,
  prompt: PromptCommandSchema,
  steer: TextParamsSchema,
  followUp: TextParamsSchema,
  abort: VOID_PARAMS,
  setModel: SetModelParamsSchema,
  setThinkingLevel: SetThinkingParamsSchema,
  getAvailableThinkingLevels: VOID_PARAMS,
  getAvailableModels: VOID_PARAMS,
  compact: CompactParamsSchema,
  newSession: NewSessionParamsSchema,
  switchSession: SwitchSessionParamsSchema,
  fork: ForkParamsSchema,
  reload: VOID_PARAMS,
  getState: VOID_PARAMS,
  getSessionId: VOID_PARAMS,
  getRuntimeInfo: VOID_PARAMS,
  listCommands: VOID_PARAMS,
  stats: StatsParamsSchema,
  shutdown: VOID_PARAMS,
};

export type ValidateResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** 下行命令的返回值（child 产出、主进程消费；两侧共用同一份结构事实源） */
export const EngineStateResultSchema = SessionStateSchema;
export const EngineCommandsResultSchema = z.array(EngineCommandSchema);
export const EngineModelsResultSchema = z.array(z.object({ provider: z.string(), id: z.string() }));
export const EngineThinkingLevelsResultSchema = z.array(z.string());

/** 未知方法一律拒绝（前向兼容时主进程应先按 unsupported 回执，而不是让 child 崩） */
export function validateRpcParams(method: unknown, params: unknown): ValidateResult<unknown> {
  if (!isEngineRpcMethod(method)) return { ok: false, error: `未知引擎命令 ${String(method)}` };
  const parsed = ENGINE_RPC_PARAM_SCHEMAS[method].safeParse(params);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.issues[0]?.message ?? "参数不合法" };
}
