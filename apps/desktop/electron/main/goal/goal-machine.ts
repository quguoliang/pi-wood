/**
 * T7.5 目标模式状态机（纯函数，无 IO / 无 electron / 无 model，可穷举单测）。
 *
 * 一个 tick = 一轮 settled 后，宿主读一次累计 token/cost + 跑一次小模型审计，把结果喂进这里，
 * 得到新的 GoalState 与一个副作用意图（Effect）：续跑发消息 / 完成·受阻·超预算·审计不可用通知。
 * 落盘、发 prompt、弹通知由 goal-runtime 执行；本模块只做判定，保证可测与无意外。
 */
import type { GoalAuditVerdict, GoalState } from "@pi-wood/ipc-schema";

export const BLOCKED_LIMIT = 3; // 连续 blocked 判定达到才终止
export const AUDIT_FAIL_LIMIT = 2; // 连续审计失败达到才判「审计不可用」（容忍 1 次瞬时故障）

export interface TickInput {
  /** 会话累计消耗 token（单调不减的读数；内部据此求增量）。 */
  totalTokens: number;
  costUsd: number;
  /** 本轮助手 turn 以 error/aborted 结束（视为受阻信号）。 */
  assistantError?: boolean;
  /** 审计裁决（成功时给）。 */
  audit?: { verdict: GoalAuditVerdict; note?: string };
  /** 审计调用失败/不可解析（与 audit 互斥）。 */
  auditFailed?: boolean;
}

export type Effect =
  | { type: "none" }
  | { type: "continue" }
  | { type: "notify"; kind: "complete" | "blocked" | "budget" | "auditUnavailable"; note?: string };

export interface StepResult {
  state: GoalState;
  effect: Effect;
}

/** 截断审计备注，避免状态膨胀。 */
const clip = (s: string | undefined): string | undefined => (s ? s.replace(/\s+/g, " ").trim().slice(0, 280) : undefined);

export function newGoalState(
  sessionId: string,
  objectiveChars: number,
  maxTurns: number,
  tokenBudget: number,
  costUsd = 0,
): GoalState {
  const now = Date.now();
  return {
    sessionId,
    status: "active",
    objectiveChars,
    turnsUsed: 0,
    maxTurns,
    tokensUsed: 0,
    tokenBudget,
    lastTotalTokens: 0,
    costUsd,
    consecutiveBlocked: 0,
    auditFailures: 0,
    updatedAt: now,
  };
}

/**
 * 推进一个 tick。非 active 状态一律 no-op（幂等，暂停/终态不消耗轮次也不续跑）。
 * 判定优先级：token 预算（硬停）> 助手报错（计受阻）> 审计失败计数 > 裁决（complete/blocked/continue）。
 * 轮次上限在「决定续跑」前拦截。
 */
export function advanceGoal(prev: GoalState, input: TickInput): StepResult {
  const s: GoalState = { ...prev, updatedAt: Date.now() };
  if (s.status !== "active") return { state: s, effect: { type: "none" } };

  // token 单调累计（compaction 分段简化：delta 只取非负）
  const delta = Math.max(0, input.totalTokens - s.lastTotalTokens);
  s.tokensUsed += delta;
  s.lastTotalTokens = input.totalTokens;
  s.costUsd = input.costUsd;

  // ① 预算硬停
  if (s.tokensUsed >= s.tokenBudget) {
    s.status = "budgetLimited";
    return { state: s, effect: { type: "notify", kind: "budget" } };
  }

  // ② 助手本轮报错 → 计入受阻（不直接终止，交给连续阈值）
  if (input.assistantError) {
    return blockedStep(s);
  }

  // ③ 审计不可用：容忍 1 次，第 2 次连续失败终止（可 resume）
  if (input.auditFailed || !input.audit) {
    s.auditFailures += 1;
    if (s.auditFailures >= AUDIT_FAIL_LIMIT) {
      s.status = "auditUnavailable";
      return { state: s, effect: { type: "notify", kind: "auditUnavailable" } };
    }
    // 单次失败：保持 active，本轮不续跑（等下一次 settle）
    return { state: s, effect: { type: "none" } };
  }
  s.auditFailures = 0;
  const note = clip(input.audit.note);

  // ④ 完成
  if (input.audit.verdict === "complete") {
    s.status = "complete";
    s.note = note;
    return { state: s, effect: { type: "notify", kind: "complete", note } };
  }

  // ⑤ 受阻（连续 BLOCKED_LIMIT 才停；单次当作继续观察）
  if (input.audit.verdict === "blocked") {
    s.note = note;
    return blockedStep(s);
  }

  // ⑥ verdict === "continue" → 轮次上限前拦截，再续跑
  s.consecutiveBlocked = 0; // 成功推进则清零受阻连击
  return continueStep(s, note);
}

function blockedStep(s: GoalState): StepResult {
  s.consecutiveBlocked += 1;
  if (s.consecutiveBlocked >= BLOCKED_LIMIT) {
    s.status = "blocked";
    return { state: s, effect: { type: "notify", kind: "blocked", note: s.note } };
  }
  // 未达阈值：继续下一轮观察（不清零受阻连击，仍累计）
  return continueStep(s, s.note);
}

function continueStep(s: GoalState, note?: string): StepResult {
  if (s.turnsUsed >= s.maxTurns) {
    s.status = "blocked";
    s.note = note ?? s.note ?? "达到自动轮次上限";
    return { state: s, effect: { type: "notify", kind: "blocked", note: s.note } };
  }
  s.turnsUsed += 1;
  s.note = note;
  return { state: s, effect: { type: "continue" } };
}
