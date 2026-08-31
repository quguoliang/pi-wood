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
});
export type SessionState = z.infer<typeof SessionStateSchema>;

// ---------- 通道名常量（main/preload/render 共用） ----------

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
} as const;
