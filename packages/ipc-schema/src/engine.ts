import { z } from "zod";

/**
 * Engine 域 IPC 契约 —— 唯一事实源（T1.1）。
 *
 * 事件类型对照 Pi SDK v0.84.4 `session.subscribe()` 实测 + 官方文档：
 * - 方案 §3.1 + v2.2 R-3 修订（auto_retry_* / summarization_retry_*）
 * - §8 实测补充：agent_settled、thinking_level_changed
 * - 自定义：approval_request / permission_granted（审批门 §10.3）
 * - 兜底：unknown（事件桥对未知 type 的归一化产物，见 @pi-wood/engine/event-bridge）
 *
 * 载荷策略：已知关键字段强类型，其余 passthrough——Pi 升级新增字段不崩，
 * 载荷细化随 T1.3 消费需求逐步收紧。
 */

// ---------- 渲染层可消费的事件（main → renderer） ----------

const AssistantMessageEventSchema = z
  .object({
    type: z.enum([
      "text_start",
      "text_delta",
      "text_end",
      "thinking_start",
      "thinking_delta",
      "thinking_end",
      "toolcall_start",
      "toolcall_delta",
      "toolcall_end",
    ]),
  })
  .passthrough();

const ToolExecutionStartSchema = z
  .object({
    type: z.literal("tool_execution_start"),
    toolCallId: z.string().optional(),
    toolName: z.string().optional(),
    input: z.unknown().optional(),
  })
  .passthrough();

const ToolExecutionUpdateSchema = z
  .object({
    type: z.literal("tool_execution_update"),
    toolCallId: z.string().optional(),
    output: z.string().optional(),
  })
  .passthrough();

const ToolExecutionEndSchema = z
  .object({
    type: z.literal("tool_execution_end"),
    toolCallId: z.string().optional(),
    isError: z.boolean().optional(),
    result: z.unknown().optional(),
  })
  .passthrough();

export const EngineEventSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("message_update"), assistantMessageEvent: AssistantMessageEventSchema })
    .passthrough(),
  z.object({ type: z.literal("message_start") }).passthrough(),
  z.object({ type: z.literal("message_end") }).passthrough(),
  ToolExecutionStartSchema,
  ToolExecutionUpdateSchema,
  ToolExecutionEndSchema,
  z
    .object({
      type: z.literal("bash_execution_update"),
      id: z.string().optional(),
      output: z.string().optional(),
      exitCode: z.number().nullable().optional(),
    })
    .passthrough(),
  z.object({ type: z.literal("agent_start") }).passthrough(),
  z.object({ type: z.literal("agent_end") }).passthrough(),
  z.object({ type: z.literal("agent_settled") }).passthrough(),
  z.object({ type: z.literal("turn_start") }).passthrough(),
  z.object({ type: z.literal("turn_end") }).passthrough(),
  z.object({ type: z.literal("queue_update") }).passthrough(),
  z.object({ type: z.literal("compaction_start") }).passthrough(),
  z.object({ type: z.literal("compaction_end") }).passthrough(),
  z.object({ type: z.literal("auto_retry_start") }).passthrough(),
  z.object({ type: z.literal("auto_retry_end") }).passthrough(),
  z.object({ type: z.literal("summarization_retry_scheduled") }).passthrough(),
  z.object({ type: z.literal("summarization_retry_attempt_start") }).passthrough(),
  z.object({ type: z.literal("summarization_retry_finished") }).passthrough(),
  z.object({ type: z.literal("model_select") }).passthrough(),
  // ⚠ 下面两条不是 Pi 事件，而是**宿主自造**并沿同一通道推的（T8.2 起要过 envelope 严格校验，故必须进契约）：
  //   user_message = 压测钩子/本地回显（debug:stress）；model_changed = 选定模型后主进程主动通知渲染层换标签。
  z.object({ type: z.literal("user_message") }).passthrough(),
  z.object({ type: z.literal("model_changed") }).passthrough(),
  z.object({ type: z.literal("thinking_level_changed") }).passthrough(),
  // 审批门自定义事件（§10.3）
  z.object({ type: z.literal("approval_request"), request: z.unknown() }).passthrough(),
  z
    .object({ type: z.literal("permission_granted"), requestId: z.string(), decision: z.string() })
    .passthrough(),
  // 事件桥兜底：未知类型不崩（R-3/§8：Pi 升级新增事件的前向兼容）
  z.object({ type: z.literal("unknown"), originalType: z.string() }),
]);

export type EngineEvent = z.infer<typeof EngineEventSchema>;
export type AssistantMessageEvent = z.infer<typeof AssistantMessageEventSchema>;

// ---------- T8.2 对话事件 envelope（main → renderer） ----------

/**
 * 多对话后事件必须可归属：`engine:event` 推的是这张信封，而不是裸事件。
 *
 * 为什么用 envelope 而不是给事件本身打标签：`EngineEventSchema` 各变体都是 `.passthrough()`，
 * 加同名字段有与 Pi 原生字段撞名的风险，且校验面会扩大到每个变体；信封只加一层、校验一次。
 *
 * ⚠ 与 child→main 的 RPC 帧（`engine-rpc.ts`，带 seq）是**两层协议**：
 *   会话归属由主进程按 handle 附加，child 自报的 conversationId 一律不信（deny-by-default 的前置）。
 */
export const ConversationEventEnvelopeSchema = z.object({
  conversationId: z.string().min(1),
  /** 该对话的工作目录（T8.6 起可能是 worktree），渲染层按「项目」维度展示/聚合 */
  projectDir: z.string(),
  /** child 侧事件帧序号（丢帧对账用；缺席 = 主进程自造事件，如 model_changed） */
  seq: z.number().int().nonnegative().optional(),
  /** 推送时该对话是否正被用户看着（渲染层据此决定逐 token 渲染 vs 只更摘要，T8.3） */
  active: z.boolean().optional(),
  event: EngineEventSchema,
});
export type ConversationEventEnvelope = z.infer<typeof ConversationEventEnvelopeSchema>;

export function makeEngineEnvelope(
  conversationId: string,
  projectDir: string,
  event: unknown,
  extra?: { seq?: number; active?: boolean },
): ConversationEventEnvelope {
  return {
    conversationId,
    projectDir,
    ...(extra?.seq !== undefined ? { seq: extra.seq } : {}),
    ...(extra?.active !== undefined ? { active: extra.active } : {}),
    event: event as ConversationEventEnvelope["event"],
  };
}

export interface UnwrappedEnginePayload {
  /** 归一后的事件载荷；null = 这条推送不可用（调用方必须计数 + warn，不许静默丢） */
  event: Record<string, unknown> | null;
  envelope: ConversationEventEnvelope | null;
  /** 旧版裸事件（无信封）→ 渲染层按 active 处理，行为与 T8.1 逐位一致 */
  legacy: boolean;
  reason?: string;
}

/**
 * 同时吃两种形状：`{conversationId, projectDir, event}`（新）与裸 `EngineEvent`（旧路径）。
 * 存在的意义是让「漏包 envelope 的推送路径」退化成旧行为而不是丢事件——但退化必须被 `legacy` 看见。
 */
export function unwrapEnginePayload(raw: unknown): UnwrappedEnginePayload {
  const env = ConversationEventEnvelopeSchema.safeParse(raw);
  if (env.success) return { event: env.data.event as unknown as Record<string, unknown>, envelope: env.data, legacy: false };
  if (typeof raw !== "object" || raw === null) {
    return { event: null, envelope: null, legacy: false, reason: "载荷不是对象" };
  }
  if ("event" in (raw as Record<string, unknown>)) {
    // 有 event 字段但信封字段不合格（缺 conversationId 等）：不能降级当裸事件，否则归属信息被静默吞掉
    return { event: null, envelope: null, legacy: false, reason: "envelope 字段不合法" };
  }
  const ev = EngineEventSchema.safeParse(raw);
  return ev.success
    ? { event: raw as Record<string, unknown>, envelope: null, legacy: true }
    : { event: null, envelope: null, legacy: false, reason: "既不是 envelope 也不是合法事件" };
}

/**
 * 渲染层路由判定：这条事件进当前对话，还是别家的（不许串台）。
 *
 * 过渡口径（T8.2 → T8.3）：渲染层还没做 slice-per-conversation，只有「当前这一条」的视图，
 * 因此 **`active === true` 一律照收**（含压测钩子等合成推送）；等 T8.3 分片后，
 * 严格按 `conversationId` 落到各自切片，`active` 只用于节流档位（逐 token vs 摘要）。
 */
export function routeForConversation(
  env: ConversationEventEnvelope | null,
  activeConversationId: string | null,
): "apply" | "foreign" {
  if (!env || env.active === true) return "apply"; // 裸事件 / 主进程标记为正被观看
  if (!activeConversationId) return "apply"; // 渲染层还没选定对话
  return env.conversationId === activeConversationId ? "apply" : "foreign";
}

// ---------- 渲染层命令（renderer → main，invoke） ----------

/** T8.2：所有引擎命令都可带 conversationId；缺省 = 当前 active 对话（旧调用零改动、行为逐位一致） */
export const ConversationRefSchema = z.object({ conversationId: z.string().min(1).optional() });

export const PromptCommandSchema = z.object({
  text: z.string().min(1),
  images: z.array(z.unknown()).optional(),
  attachments: z.array(z.string().min(1)).max(12).optional(),
  streamingBehavior: z.enum(["steer", "followUp"]).optional(),
  conversationId: z.string().min(1).optional(),
});
export type PromptCommand = z.infer<typeof PromptCommandSchema>;

export const TextCommandSchema = z.object({ text: z.string().min(1), conversationId: z.string().min(1).optional() });

export const SetModelCommandSchema = z.object({ provider: z.string(), modelId: z.string(), conversationId: z.string().min(1).optional() });
export type SetModelCommand = z.infer<typeof SetModelCommandSchema>;

export const SetThinkingCommandSchema = z.object({ level: z.string(), conversationId: z.string().min(1).optional() });

export const ForkCommandSchema = z.object({
  entryId: z.string(),
  position: z.enum(["before", "at"]),
  conversationId: z.string().min(1).optional(),
});

export const SessionStateSchema = z.object({
  sessionId: z.string().optional(),
  sessionFile: z.string().optional(),
  model: z.string().optional(),
  thinkingLevel: z.string().optional(),
  isStreaming: z.boolean().optional(),
  contextUsage: z.object({
    tokens: z.number().nullable(),
    contextWindow: z.number(),
    percent: z.number().nullable(),
  }).optional(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

// ---------- 运行时信息（EnvironmentPanel 数据源；全部字段可选，缺什么渲染层就不展示什么） ----------

export const GitInfoSchema = z.object({
  branch: z.string().optional(),
  changed: z.number(),
  added: z.number(),
  deleted: z.number(),
  files: z.array(z.object({ status: z.string(), path: z.string() })),
});
export type GitInfo = z.infer<typeof GitInfoSchema>;

export const RuntimeInfoSchema = z.object({
  cwd: z.string(),
  platform: z.string(),
  node: z.string(),
  model: z.string().optional(),
  thinkingLevel: z.string().optional(),
  isStreaming: z.boolean().optional(),
  sessionName: z.string().optional(),
  contextUsage: z
    .object({
      tokens: z.number().nullable(),
      contextWindow: z.number(),
      percent: z.number().nullable(),
    })
    .optional(),
  tools: z.array(z.string()).optional(),
  stats: z
    .object({
      userMessages: z.number(),
      assistantMessages: z.number(),
      toolCalls: z.number(),
      tokens: z.object({ input: z.number(), output: z.number(), total: z.number() }),
      cost: z.number(),
    })
    .optional(),
  // T6.6：子代理成本汇总（token/费用）。主进程对活跃 parent 会话的子代理运行注册表求和得出；
  // 无子代理时该字段缺席（渲染层据此不显示该行）。tokens = 各 child 的 input+output 之和。
  subagentUsage: z
    .object({
      tokens: z.number(),
      cost: z.number(),
      count: z.number(),
      perChild: z
        .array(
          z.object({
            id: z.string(),
            agentName: z.string(),
            tokens: z.number(),
            cost: z.number(),
            elapsedMs: z.number(),
          }),
        )
        .optional(),
    })
    .optional(),
  git: GitInfoSchema.optional(),
  // T8.1：引擎进 utilityProcess 后，一个对话 = 一个引擎进程。面板/探针据此知道「谁在跑、跑在哪、装配花了多久」。
  engineProcess: z
    .object({
      pid: z.number(),
      conversationId: z.string(),
      status: z.string(),
      bootMs: z.number().optional(),
      memRssMB: z.number().optional(),
      droppedEvents: z.number().optional(),
    })
    .optional(),
});
export type RuntimeInfo = z.infer<typeof RuntimeInfoSchema>;

// ---------- T5.1 命令面板聚合项（Pi 内建 / 扩展 / 模板 / Skill 命令） ----------

export const EngineCommandSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  source: z.enum(["extension", "prompt", "skill", "builtin"]),
});
export type EngineCommand = z.infer<typeof EngineCommandSchema>;

// ---------- T7.4 Dev Server 自动发现（本地 loopback 监听进程） ----------

export const DevServerInfoSchema = z.object({
  port: z.number().int(),
  pid: z.number().int().nullable(),
  command: z.string().nullable(),
  /** 绑定地址（如 127.0.0.1 / ::1 / 0.0.0.0 / *） */
  host: z.string(),
  /** 可直接在浏览器面板打开的预览 URL */
  url: z.string(),
});
export type DevServerInfo = z.infer<typeof DevServerInfoSchema>;

// ---------- T7.6 侧边问答（/btw：不扰动主会话的独立临时提问） ----------

export const BtwAskCommandSchema = z.object({
  question: z.string().min(1),
  /** 由渲染层从主会话裁剪的最近若干轮纯文本上下文（仅供参考，不继承执行） */
  context: z.string().optional(),
});
export type BtwAskCommand = z.infer<typeof BtwAskCommandSchema>;

// ---------- T8.4 审批 / ctx.ui 的对话归属契约（main ↔ renderer） ----------
//
// 多对话并发后，审批与 ctx.ui 往返必须带「发起对话」归属：
// - request 载荷（main → renderer）：`conversationId` = 发起对话；`projectName` = 来源项目名（来源行展示）。
//   `conversationId` 允许 null：插件宿主（T5.2）发起的 ui 请求不属于任何对话（全局项，任何对话可应答）。
// - respond 载荷（renderer → main）：`conversationId` = 渲染层应答时所处的对话（应答者归属）。
//   主进程据 `canRespond` 校验「应答者必须是发起对话」，跨对话误放行 = 安全旁路，一律拒绝。

export const ApprovalRequestPayloadSchema = z.object({
  id: z.number().int().nonnegative(),
  /** 发起对话（null = 非对话域的全局请求，现状仅审批不会出现） */
  conversationId: z.string().min(1).nullable(),
  /** 来源项目名（basename），PromptTray 来源行展示用 */
  projectName: z.string().optional(),
  title: z.string(),
  message: z.string(),
  toolName: z.string().optional(),
});
export type ApprovalRequestPayload = z.infer<typeof ApprovalRequestPayloadSchema>;

export const UiRequestPayloadSchema = z.object({
  id: z.number().int().nonnegative(),
  kind: z.enum(["select", "confirm", "input"]),
  /** 发起对话（null = 插件宿主等全局请求） */
  conversationId: z.string().min(1).nullable(),
  projectName: z.string().optional(),
  title: z.string(),
  options: z.array(z.string()).optional(),
  message: z.string().optional(),
  placeholder: z.string().optional(),
});
export type UiRequestPayload = z.infer<typeof UiRequestPayloadSchema>;

export const ApprovalRespondPayloadSchema = z.object({
  id: z.number().int().nonnegative(),
  /** 应答者所处的对话（须与发起对话一致，否则拒绝） */
  conversationId: z.string().min(1).nullable().optional(),
  allow: z.boolean(),
});
export type ApprovalRespondPayload = z.infer<typeof ApprovalRespondPayloadSchema>;

export const UiRespondPayloadSchema = z.object({
  id: z.number().int().nonnegative(),
  conversationId: z.string().min(1).nullable().optional(),
  value: z.union([z.string(), z.boolean()]).optional(),
});
export type UiRespondPayload = z.infer<typeof UiRespondPayloadSchema>;

// ---------- T6.3 子代理运行时状态（vendored pi-subagent 的 runs 注册表快照） ----------

export const SubagentRunInfoSchema = z.object({
  /** run id（agent_start/agent_wait 用的那个） */
  id: z.string(),
  /** 子代理 profile 名（agent_start 的 agent 参数） */
  agent: z.string(),
  /** harness 名（当前恒为 pi） */
  harness: z.string(),
  /** 该 run 的一句话标签（description） */
  description: z.string(),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  /** 已用/总耗时（毫秒；running 时为截至最近一次事件的耗时） */
  elapsedMs: z.number(),
  /** 轮次数 */
  turns: z.number(),
  /** 实时活动（当前工具/思考摘要），仅展示用 */
  activity: z.string().optional(),
});
export type SubagentRunInfo = z.infer<typeof SubagentRunInfoSchema>;

// ---------- 通道名常量（main/preload/render 共用） ----------

/** T3.3：engine:getPiTheme 返回的 Pi 主题描述（无配置主题时返回 null）。mode 由渲染层 theme-adapter 推导。 */
export interface EnginePiTheme {
  name: string;
  vars: Record<string, string | number>;
  colors: Record<string, string | number>;
}

export const ENGINE_CHANNELS = {
  event: "engine:event",
  diff: "engine:diff",
  prompt: "engine:prompt",
  steer: "engine:steer",
  followUp: "engine:followUp",
  abort: "engine:abort",
  setModel: "engine:setModel",
  setThinking: "engine:setThinking",
  compact: "engine:compact",
  newSession: "engine:newSession",
  switchSession: "engine:switchSession",
  fork: "engine:fork",
  getState: "engine:getState",
  getRuntimeInfo: "engine:getRuntimeInfo",
  listCommands: "engine:listCommands",
  listDevServers: "engine:listDevServers",
  btwEvent: "engine:btwEvent",
  btwAsk: "engine:btwAsk",
  btwAbort: "engine:btwAbort",
  btwClose: "engine:btwClose",
  assistResult: "engine:assistResult",
  // T6.3：子代理 runs 快照（subagentRuns=main→renderer 推送；subagentList=renderer→main 拉取初值）
  subagentRuns: "engine:subagentRuns",
  subagentList: "engine:subagentList",
  // T6.5：单条 child 会话事件（{runId, event}）推送，供只读子会话视图实时渲染
  subagentEvent: "engine:subagentEvent",
  // T3.3：读取当前 Pi 主题 JSON（renderer→main 拉取，用于全应用换肤）
  getPiTheme: "engine:getPiTheme",
  // T7.12：读取月度用量/配额视图（renderer→main 拉取）
  getUsage: "engine:getUsage",
  // ---- T8.2 对话域（渲染层接线在 T8.3 的多对话标签条）----
  /** 拉注册表快照（含 status / droppedEvents / pendingApprovals） */
  listConversations: "engine:listConversations",
  /** 显式新建一条对话（同项目多对话等 T8.6 worktree 落地才真正放开） */
  createConversation: "engine:createConversation",
  /** 手动休眠 / 关闭某条对话（释放引擎进程，保留会话文件） */
  suspendConversation: "engine:suspendConversation",
  closeConversation: "engine:closeConversation",
  /** 渲染层告知「用户正在看这条」：主进程据此做可见性节流（T8.3）与命令缺省归属 */
  setActiveConversation: "engine:setActiveConversation",
  // ---- T8.6 worktree 域（设置「工作树」页与回流按钮；UI 随 T8.8 接线）----
  /** 列出本项目管辖范围内的未回收工作树（孤儿对账视图） */
  worktreeList: "engine:worktreeList",
  /** 回流：把某对话工作树的改动 `git apply --3way --ignore-whitespace` 进主工作树（冲突不自动合） */
  worktreeMergeBack: "engine:worktreeMergeBack",
  /** 回收某对话的工作树（脏树拒绝；force=显式丢弃） */
  worktreeRemove: "engine:worktreeRemove",
} as const;
