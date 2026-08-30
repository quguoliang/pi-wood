import { z } from "zod";

/**
 * Engine 域 IPC 契约（T1.1 正式化）。
 * 事件类型对照 Pi SDK session.subscribe() 官方事件（方案 §3.1 + v2.2 R-3 修订）。
 * 当前为骨架种子：仅含事件名清单，T1.1 补全各事件载荷类型。
 */
export const ENGINE_EVENT_TYPES = [
  "message_update",
  "message_start",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "bash_execution_update",
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "queue_update",
  "compaction_start",
  "compaction_end",
  "auto_retry_start",
  "auto_retry_end",
  "summarization_retry_scheduled",
  "summarization_retry_attempt_start",
  "summarization_retry_finished",
  "model_select",
  "approval_request",
  "permission_granted",
] as const;

export const EngineEventSchema = z.object({
  type: z.enum(ENGINE_EVENT_TYPES),
  payload: z.unknown().optional(),
});
export type EngineEvent = z.infer<typeof EngineEventSchema>;
export type EngineEventType = (typeof ENGINE_EVENT_TYPES)[number];
