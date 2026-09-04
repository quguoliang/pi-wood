import { Notification } from "electron";
import {
  DEFAULT_MAX_TURNS,
  DEFAULT_TOKEN_BUDGET,
  GOAL_CHANNELS,
  type GoalState,
} from "@pi-wood/ipc-schema";
import { advanceGoal, newGoalState } from "./goal-machine.ts";
import { buildContinuationPrompt, buildKickoffPrompt, type AuditResult } from "./goal-prompt.ts";
import { auditGoal } from "./goal-audit.ts";
import { planGoalBegin } from "../engine/concurrency-gates.ts";
import {
  clearGoal,
  goalsDir,
  readGoalState,
  readObjective,
  writeGoalState,
  writeObjective,
} from "./goal-store.ts";

/**
 * T7.5 目标模式运行时：事件驱动的控制循环。宿主在会话 settled 时读一次累计 token、跑一次小模型
 * 审计，喂进纯函数状态机 `advanceGoal`，据效果续跑发 prompt / 终止并通知。审计只看目标 + 最近一轮回复。
 * 为可测与解耦：本模块**不 import 引擎/SDK**，会话侧读写经注入的 `GoalAdapter`，审计经注入的 `Auditor`
 * （生产用真 adapter + `auditGoal`，headless 探针注入 fake 跑确定性全链路）。
 */

export interface GoalAdapter {
  /** 当前会话 id（goal 以此为键）。 */
  sessionId: string;
  /** 发一条 prompt 续跑（主会话）。 */
  prompt(text: string): Promise<void>;
  /** 读会话累计 token/费用（供预算判定，单调不减）。 */
  stats(): Promise<{ totalTokens: number; costUsd: number }>;
}

export type Auditor = (objective: string, assistantText: string) => Promise<AuditResult | undefined>;

let dir = "";
let sendToRenderer: (channel: string, data: unknown) => void = () => {};
const cache = new Map<string, GoalState>();

export function configureGoalRuntime(opts: {
  appDataDir: string;
  sendToRenderer: (channel: string, data: unknown) => void;
}): void {
  dir = goalsDir(opts.appDataDir);
  sendToRenderer = opts.sendToRenderer;
}

function load(sessionId: string): GoalState | null {
  const cached = cache.get(sessionId);
  if (cached) return cached;
  const st = readGoalState(dir, sessionId);
  if (st) cache.set(sessionId, st);
  return st;
}

function persist(s: GoalState): void {
  cache.set(s.sessionId, s);
  writeGoalState(dir, s);
  sendToRenderer(GOAL_CHANNELS.status, s);
}

export function getGoalState(sessionId: string): GoalState | null {
  return load(sessionId);
}

/** T8.5 goal 互斥：当前处于 active 的 goal 会话列表（跨对话判定用） */
export function listActiveGoalSessions(): string[] {
  return [...cache.values()].filter((s) => s.status === "active").map((s) => s.sessionId);
}

export interface BeginOptions {
  tokenBudget?: number;
  maxTurns?: number;
  /** 目标开启时会话已消耗的累计 token（作 baseline，避免把历史算进目标预算）。 */
  initialTotalTokens?: number;
  initialCostUsd?: number;
  /**
   * T8.5 互斥：同时只允许一个对话 goal active（目标模式每轮自动续跑 ×N 对话 = 成本乘积失控）。
   * 冲突时不带 force → 抛错（调用方转用户提示）；force=true → 强制接管（自动暂停前者）。
   */
  force?: boolean;
}

/** 设目标：写正文文件 + 建 active 状态；返回 kickoff prompt 供调用方发到主会话开跑。 */
export function beginGoal(sessionId: string, objective: string, opts: BeginOptions = {}): { state: GoalState; kickoff: string } {
  const mutex = planGoalBegin(listActiveGoalSessions(), sessionId);
  if (!mutex.ok) {
    if (!opts.force) {
      throw new Error(
        `已有另一对话的目标正在自动续跑。同时跑多个 goal 会让 token 成本失控——请先暂停它，或用「强制接管」（前者将自动暂停）。`,
      );
    }
    pauseGoal(mutex.conflictSessionId);
  }
  const state = newGoalState(
    sessionId,
    objective.length,
    opts.maxTurns ?? DEFAULT_MAX_TURNS,
    opts.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
    opts.initialCostUsd ?? 0,
  );
  state.lastTotalTokens = opts.initialTotalTokens ?? 0;
  writeObjective(dir, sessionId, objective);
  persist(state);
  return { state, kickoff: buildKickoffPrompt(objective) };
}

export function pauseGoal(sessionId: string): GoalState | null {
  const s = load(sessionId);
  if (!s || s.status !== "active") return s;
  const next = { ...s, status: "paused" as const, updatedAt: Date.now() };
  persist(next);
  return next;
}

/** 恢复：从 paused / 各终态回到 active，清受阻与审计失败计数。T8.5：同样受 goal 互斥约束（force 可接管）。 */
export function resumeGoal(sessionId: string, opts: { force?: boolean } = {}): GoalState | null {
  const s = load(sessionId);
  if (!s || s.status === "active") return s;
  const mutex = planGoalBegin(listActiveGoalSessions(), sessionId);
  if (!mutex.ok && !opts.force) {
    throw new Error("另一对话的目标正在自动续跑；恢复本目标请先暂停它，或强制接管。");
  }
  if (!mutex.ok) pauseGoal(mutex.conflictSessionId);
  const next: GoalState = {
    ...s,
    status: "active",
    consecutiveBlocked: 0,
    auditFailures: 0,
    note: undefined,
    updatedAt: Date.now(),
  };
  persist(next);
  return next;
}

export function clearGoalFor(sessionId: string): void {
  cache.delete(sessionId);
  clearGoal(dir, sessionId);
  sendToRenderer(GOAL_CHANNELS.status, null);
}

export function updateObjective(sessionId: string, text: string): void {
  writeObjective(dir, sessionId, text);
  const s = load(sessionId);
  if (s) persist({ ...s, objectiveChars: text.length, updatedAt: Date.now() });
}

const NOTIFY: Record<"complete" | "blocked" | "budget" | "auditUnavailable", string> = {
  complete: "目标已完成",
  blocked: "目标受阻，已暂停自动推进",
  budget: "目标 token 预算耗尽，已停止",
  auditUnavailable: "进度审计暂不可用，目标已暂停",
};

function notifyGoal(state: GoalState, kind: keyof typeof NOTIFY, note?: string): void {
  try {
    if (Notification.isSupported()) {
      new Notification({ title: `pi-wood · ${NOTIFY[kind]}`, body: note ?? "" }).show();
    }
  } catch {
    /* 通知失败不影响目标状态机 */
  }
}

/**
 * 会话 settled 钩子（engine-manager 每轮 settle 调用）。非 active goal / 无 goal → no-op。
 * `aborted=true`（用户本轮停止）→ 暂停 goal（不判受阻，可恢复）。
 * 顺序：读 stats → 审计 → advanceGoal → **先持久化 accounting/turnsUsed（防崩溃后双发续跑）→ 再发续跑或通知**。
 */
export async function onGoalSettled(
  adapter: GoalAdapter,
  assistantText: string,
  opts: { aborted?: boolean; auditor?: Auditor } = {},
): Promise<void> {
  const sessionId = adapter.sessionId;
  const s = sessionId ? load(sessionId) : null;
  if (!s || s.status !== "active") return;

  // 用户主动停止当前轮 → 暂停 goal（区别于「受阻」），保留计数供 resume。
  if (opts.aborted) {
    persist({ ...s, status: "paused", updatedAt: Date.now() });
    return;
  }

  const objective = readObjective(dir, sessionId) ?? "";
  let stats = { totalTokens: s.lastTotalTokens, costUsd: s.costUsd };
  try {
    stats = await adapter.stats();
  } catch {
    /* stats 读失败按上次值，delta=0，不误触预算 */
  }
  let audit: AuditResult | undefined;
  try {
    audit = await (opts.auditor ?? auditGoal)(objective, assistantText);
  } catch {
    audit = undefined;
  }

  const { state: next, effect } = advanceGoal(s, {
    totalTokens: stats.totalTokens,
    costUsd: stats.costUsd,
    audit,
    auditFailed: !audit,
  });
  persist(next); // 先落盘（含 turnsUsed），崩溃后不会重复发同一条续跑

  if (effect.type === "continue") {
    try {
      await adapter.prompt(buildContinuationPrompt(objective, next));
    } catch {
      /* 续跑发送失败：状态已推进，等下一次 settle */
    }
  } else if (effect.type === "notify") {
    notifyGoal(next, effect.kind, effect.note);
  }
}
