/**
 * T8.5 并发闸门纯逻辑
 *
 * 多对话并发后，「无上限」会放大成成本与资源事故（N 对话 × goal 自动续跑 = 乘积）。
 * 本模块收敛四类闸门的可判定部分（node --test 穷举），有状态的一侧（等待/定时器/镜像）
 * 在 engine-manager / 各 service，只做「记录 + 调用」：
 *
 * 1. prompt 闸门：全局在飞 ≤ min(prompt 上限, 活跃引擎数)（进程数才是资源上限，prompt 闸是成本闸）；
 *    连续限流（429/配额超限 throttle 档）时临时降到 1。
 * 2. 子代理全局闸：agent_start 接缝排队而非 spawn（不改 vendored 内核、不违反其 ADR 0001
 *    「无上限」设计——闸门在宿主侧）。每 agent_start 恰好产 1 个 run（vendor 事实），
 *    「预约-快照对账」保证并发判定无竞态：acquire 时 reserved++，runs 快照里 run 真正转 running
 *    时按差值把 reserved 折算成 running；审批被拒则显式退还预约。
 * 3. goal 互斥：同时最多 1 个对话 goal active（可强制接管=自动暂停前者）。
 * 4. 配额动作：月配额超限时按设置 throttle（限 1） / block（拦新建对话） / warn（仅告警）。
 */

// ---------- 通用：上限归一 ----------

/** 归一并发上限：非法输入回落默认值，合法输入 clamp 进 [min,max]（空串/0 不得静默变成 1） */
export function clampLimit(value: unknown, fallback: number, min: number, max: number): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(n)) return Math.min(max, Math.max(min, fallback));
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

// ---------- prompt 闸门 ----------

/**
 * prompt 全局并发上限 = min(设置 prompt 上限, 活跃引擎子进程数)。
 * 进程数是真正的资源上限（T8.0 实测每对话一个 child），prompt 闸是成本/限流闸——
 * 取交集意味着任何一个收紧都生效；限流退避时临时降到 1。
 */
export function effectivePromptLimit(
  promptLimit: unknown,
  maxLiveEngines: number,
  opts: { rateLimited?: boolean } = {},
): number {
  if (opts.rateLimited) return 1;
  return Math.min(clampLimit(promptLimit, 3, 1, 6), clampLimit(maxLiveEngines, 3, 1, 4));
}

export interface GateStats {
  running: number;
  queued: number;
  limit: number;
}

/**
 * 全局槽位闸（FIFO 唤醒）。用于 prompt 全局在飞上限与第二运行时（AI 审查 / goal 审计）
 * 「全局并发 ≤2 + 排队可见」。
 */
export class SlotGate {
  private limit: number;
  private running = 0;
  private waiters: Array<{ wake: () => void; wasQueued: boolean }> = [];

  constructor(limit: number) {
    this.limit = Math.max(1, Math.trunc(limit));
  }

  setLimit(limit: number): void {
    this.limit = Math.max(1, Math.trunc(limit));
    this.pump();
  }

  /** 立即判断「现在来一个会不会排队」（供调用方先把对话标成「排队中」） */
  wouldQueue(): boolean {
    return this.running >= this.limit;
  }

  /** 取一个槽位；返回是否排过队（FIFO，唤醒顺序 = 到达顺序） */
  async acquire(): Promise<boolean> {
    if (this.running < this.limit && this.waiters.length === 0) {
      this.running += 1;
      return false;
    }
    return await new Promise<boolean>((resolve) => {
      this.waiters.push({ wake: () => resolve(true), wasQueued: true });
    });
  }

  release(): void {
    this.running = Math.max(0, this.running - 1);
    this.pump();
  }

  stats(): GateStats {
    return { running: this.running, queued: this.waiters.length, limit: this.limit };
  }

  private pump(): void {
    while (this.running < this.limit && this.waiters.length > 0) {
      const w = this.waiters.shift();
      if (!w) break;
      this.running += 1;
      w.wake();
    }
  }
}

// ---------- 子代理全局闸（预约-快照对账） ----------

export interface ChildRunGateState {
  /** convId → 最近一次 runs 快照里的 running 数 */
  running: Record<string, number>;
  /** 快照对账基线（上次见到的 running 数，用于把增量从 reserved 折算成 running） */
  lastSeen: Record<string, number>;
  /** 已放行、run 尚未在快照里转 running 的预约数 */
  reserved: Record<string, number>;
}

export function newChildRunGateState(): ChildRunGateState {
  return { running: {}, lastSeen: {}, reserved: {} };
}

export interface ChildRunLimits {
  /** per-对话 ≤4（默认） */
  perConversation: number;
  /** 跨对话共享 ≤6（默认） */
  global: number;
}

export type ChildRunAdmitPlan =
  | { action: "admit" }
  | { action: "queue"; reason: string };

/** 已占用（running + reserved）：预约算占用，否则同刻多对话 acquire 会竞态超限 */
function committedOf(state: ChildRunGateState, convId: string): number {
  return (state.running[convId] ?? 0) + (state.reserved[convId] ?? 0);
}

function committedGlobal(state: ChildRunGateState): number {
  let total = 0;
  for (const id of new Set([...Object.keys(state.running), ...Object.keys(state.reserved)])) {
    total += committedOf(state, id);
  }
  return total;
}

/** agent_start 接缝的准入判定：超限 → 排队（等 runs 快照变化后再判） */
export function planChildRunAdmit(
  state: ChildRunGateState,
  conversationId: string,
  limits: ChildRunLimits,
): ChildRunAdmitPlan {
  const perConv = clampLimit(limits.perConversation, 4, 1, 8);
  const global = clampLimit(limits.global, 6, 1, 12);
  if (committedOf(state, conversationId) >= perConv) {
    return { action: "queue", reason: `该对话子代理并发已达上限 ${perConv}` };
  }
  if (committedGlobal(state) >= global) {
    return { action: "queue", reason: `全局子代理并发已达上限 ${global}` };
  }
  return { action: "admit" };
}

/** 放行前预约一个名额（run 尚未出现在 runs 快照里） */
export function reserveChildRun(state: ChildRunGateState, conversationId: string): void {
  state.reserved[conversationId] = (state.reserved[conversationId] ?? 0) + 1;
}

/** 审批被拒 / 启动失败：显式退还预约（不退还 = 名额泄漏，之后永远少一个槽） */
export function releaseChildRunReservation(state: ChildRunGateState, conversationId: string): void {
  state.reserved[conversationId] = Math.max(0, (state.reserved[conversationId] ?? 0) - 1);
}

/**
 * runs 快照对账（latest-wins 镜像更新时调用）：
 * 把「自上次快照以来新转 running」的 run 从 reserved 折算成 running。
 * run 结束（running 数下降）自然释放占用。返回本次新启动数（供调试/探针）。
 */
export function applyRunsSnapshot(state: ChildRunGateState, conversationId: string, runningCount: number): number {
  const prev = state.lastSeen[conversationId] ?? 0;
  const started = Math.max(0, runningCount - prev);
  if (started > 0) {
    state.reserved[conversationId] = Math.max(0, (state.reserved[conversationId] ?? 0) - started);
  }
  state.running[conversationId] = Math.max(0, runningCount);
  state.lastSeen[conversationId] = Math.max(0, runningCount);
  return started;
}

/** 对话被关停：其全部占用出清（child 已死，runs 不会再更新） */
export function dropChildRunState(state: ChildRunGateState, conversationId: string): void {
  delete state.running[conversationId];
  delete state.lastSeen[conversationId];
  delete state.reserved[conversationId];
}

// ---------- goal 互斥 ----------

export type GoalBeginPlan =
  | { ok: true }
  | { ok: false; conflictSessionId: string; canForce: true };

/**
 * 同时最多 1 个对话 goal active。冲突时 canForce=true：强制接管 = 调用方先暂停前者再建。
 * sessionId 本身已 active 不算冲突（重复 begin 同一会话按幂等处理交给上层）。
 */
export function planGoalBegin(activeGoalSessions: readonly string[], sessionId: string): GoalBeginPlan {
  const other = activeGoalSessions.find((id) => id && id !== sessionId);
  if (other) return { ok: false, conflictSessionId: other, canForce: true };
  return { ok: true };
}

// ---------- 配额动作 ----------

export type QuotaOverLimitAction = "throttle" | "block" | "warn";

export function normalizeQuotaAction(value: unknown, fallback: QuotaOverLimitAction = "warn"): QuotaOverLimitAction {
  return value === "throttle" || value === "block" || value === "warn" ? value : fallback;
}

export interface QuotaGuardEffect {
  /** prompt 全局并发临时降到 1 */
  throttle: boolean;
  /** 阻止新建对话 */
  blockNewConversation: boolean;
}

export function quotaGuardEffect(action: QuotaOverLimitAction, overQuota: boolean): QuotaGuardEffect {
  if (!overQuota) return { throttle: false, blockNewConversation: false };
  return {
    throttle: action === "throttle",
    blockNewConversation: action === "block",
  };
}
