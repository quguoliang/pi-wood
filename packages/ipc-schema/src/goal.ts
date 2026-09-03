import { z } from "zod";

/**
 * T7.5 目标模式（Session Goal）IPC 契约（方案 §7.8 / OpenChamber session-goal runtime）。
 * 状态字段小（枚举/计数/备注），目标正文另存文件不进这里（防膨胀 + 防注入，见 §8）。
 */

/** 审计小模型对「目标是否推进/完成」的裁决。 */
export const GoalAuditVerdictSchema = z.enum(["continue", "complete", "blocked"]);
export type GoalAuditVerdict = z.infer<typeof GoalAuditVerdictSchema>;

/** 目标生命周期状态。 */
export const GoalStatusSchema = z.enum([
  "active", // 运行中（自动续跑）
  "paused", // 用户暂停，可恢复
  "complete", // 审计判定完成
  "blocked", // 连续受阻 / 轮次上限 / 助手报错
  "budgetLimited", // token 预算耗尽
  "auditUnavailable", // 连续审计失败（可 resume）
]);
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

export const GoalStateSchema = z.object({
  sessionId: z.string(),
  status: GoalStatusSchema,
  objectiveChars: z.number(), // 目标正文长度（正文在文件里，不在此）
  turnsUsed: z.number(), // 已自动续跑轮次
  maxTurns: z.number(),
  tokensUsed: z.number(), // 目标开启后累计消耗 token
  tokenBudget: z.number(),
  /** 上一次读数时的会话累计 token（供下次 tick 求单调增量；compaction 后仍只增不减）。 */
  lastTotalTokens: z.number(),
  costUsd: z.number(),
  consecutiveBlocked: z.number(),
  auditFailures: z.number(),
  note: z.string().optional(), // 审计备注（≤280）
  updatedAt: z.number(),
});
export type GoalState = z.infer<typeof GoalStateSchema>;

export const GOAL_CHANNELS = {
  set: "goal:set", // renderer→main：设目标（objective + budget?）
  get: "goal:get", // 取当前会话 goal 状态（无则 null）
  pause: "goal:pause",
  resume: "goal:resume",
  clear: "goal:clear",
  updateObjective: "goal:updateObjective", // 中途编辑目标正文
  status: "goal:status", // main→renderer：状态推送
} as const;

export const DEFAULT_MAX_TURNS = 20;
export const DEFAULT_TOKEN_BUDGET = 400_000;
