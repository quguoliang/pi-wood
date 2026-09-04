/**
 * 对话注册表的纯逻辑（T8.1）
 *
 * 只放**不需要 electron / 不需要引擎**的可判定部分：状态机迁移、LRU 选谁关停、
 * seq 对账、崩溃退避。这样并发批次的四条硬验收（超限只关最旧的非在跑对话、
 * streaming 中永不自动休眠、丢帧不静默、退避重启 ≤3）全部能在 `node --test` 里穷举，
 * 不必真起 3 个 utilityProcess 去碰运气。
 *
 * 有状态的一侧（fork / RPC / 进程句柄）在 conversation-registry.ts，它只做「记录 + 调用」，
 * 判定一律转交这里。
 */

export type ConversationStatus =
  | "spawning" // child 已 fork，引擎尚未 ready（T8.0 实测装配 ≈1.1s）
  | "idle" // 引擎在、没在跑轮次 —— 唯一可被自动关停的状态
  | "streaming" // 一轮在飞
  | "waiting_approval" // 等用户应答（含 ctx.ui 往返）
  | "queued" // steer/followUp 排队中
  | "suspended" // child 已优雅退出，只留 sessionFile + worktreePath
  | "dead"; // child 崩溃或被硬杀，可一键恢复

export interface ConversationRecord {
  id: string;
  projectDir: string;
  /** T8.6 起为「该对话独占的 git worktree」；此前与 projectDir 相同 */
  worktreePath?: string;
  status: ConversationStatus;
  /** 单调时钟语义由调用方保证（主进程传 performance.now() 或 Date.now() 皆可，只要同源） */
  lastActiveAt: number;
  /** child 上报的最后一个事件帧 seq（0 = 尚未收到任何事件） */
  lastSeq: number;
  /** 事件帧丢帧/乱序计数（丢帧不许静默，验收项） */
  droppedEvents: number;
  /** 有一轮 prompt 的 invoke 挂起未回 */
  inFlightPrompt: boolean;
  pendingApprovals: number;
  /** 本会话已用掉的退避重启次数（上限见 maxRestarts） */
  restarts: number;
  sessionFile?: string;
  pid?: number;
}

/** 还占着一个引擎进程（= 计入 MAX_LIVE_ENGINES）的状态 */
export const LIVE_STATUSES: readonly ConversationStatus[] = ["spawning", "idle", "streaming", "waiting_approval", "queued"];
/** 不占进程、可安全丢弃内存态的状态 */
export const RESTING_STATUSES: readonly ConversationStatus[] = ["suspended", "dead"];

export function isLive(rec: Pick<ConversationRecord, "status">): boolean {
  return LIVE_STATUSES.includes(rec.status);
}

const TRANSITIONS: Record<ConversationStatus, readonly ConversationStatus[]> = {
  spawning: ["idle", "streaming", "waiting_approval", "dead"],
  idle: ["streaming", "queued", "spawning", "suspended", "dead"],
  streaming: ["idle", "waiting_approval", "queued", "dead"],
  waiting_approval: ["streaming", "idle", "queued", "dead"],
  queued: ["streaming", "idle", "dead"],
  suspended: ["spawning", "dead"],
  dead: ["spawning", "idle", "streaming", "waiting_approval", "queued", "suspended"],
};

/** 崩溃/关停可以从任何状态直接落到 dead，故同态与 dead 一律放行 */
export function canTransition(from: ConversationStatus, to: ConversationStatus): boolean {
  if (from === to) return true;
  if (to === "dead") return true;
  return TRANSITIONS[from].includes(to);
}

/** 迁移：非法迁移抛错（宁可开发期炸，也不要静默把对话卡死在错误状态） */
export function transition(from: ConversationStatus, to: ConversationStatus): ConversationStatus {
  if (!canTransition(from, to)) {
    throw new Error(`非法对话状态迁移 ${from} → ${to}`);
  }
  return to;
}

/** 事件 seq 对账：返回新状态 + 是否接受该帧（重复/倒退帧丢弃但不断档） */
export function applyEventSeq(
  rec: Pick<ConversationRecord, "lastSeq" | "droppedEvents">,
  seq: number,
): { lastSeq: number; droppedEvents: number; accepted: boolean; gap: number } {
  if (!Number.isInteger(seq) || seq < 0) {
    return { lastSeq: rec.lastSeq, droppedEvents: rec.droppedEvents, accepted: false, gap: 0 };
  }
  if (seq <= rec.lastSeq) {
    return { lastSeq: rec.lastSeq, droppedEvents: rec.droppedEvents, accepted: false, gap: 0 };
  }
  const gap = seq - rec.lastSeq - 1;
  return { lastSeq: seq, droppedEvents: rec.droppedEvents + gap, accepted: true, gap };
}

export interface SuspendPickOptions {
  /** 用户正在看的对话：永不自动关停 */
  activeId?: string;
  /** 额外保护（例如刚被用户显式唤起的对话） */
  excludeIds?: readonly string[];
}

/**
 * 可自动休眠判定。注意 `session.dispose()` 内含 `abortBash()`（SDK 实测）→
 * 休眠会杀掉正在跑的 `npm test` 并可能留下半执行副作用，所以**只在轮次边界**动手。
 */
export function isSuspendSafe(rec: ConversationRecord): boolean {
  return rec.status === "idle" && !rec.inFlightPrompt && rec.pendingApprovals === 0;
}

/** LRU 选人：只从「可安全休眠」里挑最久未活跃者；同刻则按 id 定序（保证可复现） */
export function pickSuspendCandidate(
  records: readonly ConversationRecord[],
  opts: SuspendPickOptions = {},
): string | undefined {
  const excluded = new Set<string>([...(opts.excludeIds ?? []), ...(opts.activeId ? [opts.activeId] : [])]);
  const eligible = records.filter((r) => !excluded.has(r.id) && isSuspendSafe(r));
  if (eligible.length === 0) return undefined;
  eligible.sort((a, b) => (a.lastActiveAt === b.lastActiveAt ? (a.id < b.id ? -1 : 1) : a.lastActiveAt - b.lastActiveAt));
  return eligible[0].id;
}

export type AdmitPlan =
  | { action: "admit" }
  | { action: "suspend-first"; conversationId: string }
  | { action: "reject"; reason: string };

/**
 * 新建/唤醒一个对话前的准入判定（超限**不静默杀任务**）：
 * 有空位 → 直接进；满 → 若存在可休眠者则先休眠它；全在跑 → 拒绝并给出原因。
 */
export function planAdmit(records: readonly ConversationRecord[], maxLive: number, opts: SuspendPickOptions = {}): AdmitPlan {
  const live = records.filter((r) => isLive(r)).length;
  if (live < maxLive) return { action: "admit" };
  const victim = pickSuspendCandidate(records, opts);
  if (victim) return { action: "suspend-first", conversationId: victim };
  return {
    action: "reject",
    reason: `已有 ${live} 个引擎在跑且全部处于活跃状态（并发上限 ${maxLive}）。请等某一轮跑完或先手动休眠一个对话。`,
  };
}

/** 归一化并发上限：只接受 1~4（T8.0 实测每对话 child RSS ≈200MB，4 路≈800MB 是本机红线） */
export function normalizeMaxLiveEngines(value: unknown, fallback = 3): number {
  // ⚠ 不能用裸 Number(value)：Number(null)/Number("")/Number([]) 都是 0 → 会被 clamp 成 1，
  // 等于「设置项缺失/为空就把并发压到 1」这种静默降级。非数字输入一律回落默认值。
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(n)) return clamp(Math.trunc(fallback), 1, 4);
  return clamp(Math.trunc(n), 1, 4);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export interface RestartPlan {
  allowed: boolean;
  delayMs: number;
  attempt: number;
}

/**
 * child 崩溃后的退避重启（沿用 plugin-host 范式：次数封顶 + 指数退避）。
 * `attempt` 从 1 起算；超过 maxRestarts 不再自动重启（标记 dead，交给用户一键恢复）。
 */
export function planRestart(restarts: number, opts: { maxRestarts?: number; baseMs?: number; capMs?: number } = {}): RestartPlan {
  const maxRestarts = opts.maxRestarts ?? 3;
  const baseMs = opts.baseMs ?? 500;
  const capMs = opts.capMs ?? 8_000;
  const attempt = restarts + 1;
  if (attempt > maxRestarts) return { allowed: false, delayMs: 0, attempt };
  return { allowed: true, delayMs: Math.min(capMs, baseMs * 2 ** (attempt - 1)), attempt };
}

/** 崩溃后是否还值得恢复：suspended/dead 无进程，恢复走重新 fork */
export function canRecover(rec: ConversationRecord): boolean {
  return rec.status === "dead" || rec.status === "suspended";
}

/** 注册表快照（推给渲染层/T8.2 envelope 用的最小面，纯函数便于断言） */
export function summarizeConversations(records: readonly ConversationRecord[]): Array<{
  id: string;
  status: ConversationStatus;
  projectDir: string;
  lastActiveAt: number;
  droppedEvents: number;
  pendingApprovals: number;
}> {
  return records.map((r) => ({
    id: r.id,
    status: r.status,
    projectDir: r.projectDir,
    lastActiveAt: r.lastActiveAt,
    droppedEvents: r.droppedEvents,
    pendingApprovals: r.pendingApprovals,
  }));
}
