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

// ---------- 渲染层命令（renderer → main，invoke） ----------

export const PromptCommandSchema = z.object({
  text: z.string().min(1),
  images: z.array(z.unknown()).optional(),
  attachments: z.array(z.string().min(1)).max(12).optional(),
  streamingBehavior: z.enum(["steer", "followUp"]).optional(),
});
export type PromptCommand = z.infer<typeof PromptCommandSchema>;

export const TextCommandSchema = z.object({ text: z.string().min(1) });

export const SetModelCommandSchema = z.object({ provider: z.string(), modelId: z.string() });
export type SetModelCommand = z.infer<typeof SetModelCommandSchema>;

export const SetThinkingCommandSchema = z.object({ level: z.string() });

export const ForkCommandSchema = z.object({
  entryId: z.string(),
  position: z.enum(["before", "at"]),
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
} as const;
