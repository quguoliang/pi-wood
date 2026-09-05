/**
 * 延迟度量出口（T8.9 · §7.9 性能红线「先有度量，再谈达标」）
 *
 * 红线表里 RPC 往返、事件到达两跳、审批往返、切换首屏这四行长期是「有预算、无口径」的愿望：
 * 探针没有可自动判定的统计出口，就没法标达标也没法标不达标。本模块把「怎么算 p50/p95」
 * 定成唯一事实源（纯函数、electron-free、可 `node --test` 穷举），主进程/探针/渲染层共用。
 *
 * 三条刻意的纪律：
 * 1. **窗口化**：只保留最近 `capacity` 个样本（环形覆盖），p95 是「近 N 帧窗口」的分位数——
 *    长跑进程用全量样本会让早期抖动永久污染结论，也会无界吃内存。被覆盖的帧数计入 `dropped`。
 * 2. **脏样本不静默**：非有限数、负数（时钟回拨/跨进程偏差）一律拒收并计入 `invalid`，
 *    而不是悄悄塞进窗口拉低 p95。
 * 3. **无样本 ≠ 达标**：`budgetVerdict()` 对 `count===0` 返回不通过并写明「该路径本轮未触发」。
 *    拿 SKIP 冒充已测是这张红线表最初被立出来的原因，不能再犯一次。
 */

import type { EngineRpcMethod } from "./engine-rpc.ts";

export interface LatencySnapshot {
  /** 窗口内样本数 */
  count: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
  /** 因容量上限被覆盖的样本数（累计） */
  dropped: number;
  /** 因非有限数/负数被拒收的样本数（累计） */
  invalid: number;
}

export const EMPTY_LATENCY: LatencySnapshot = {
  count: 0,
  p50: 0,
  p95: 0,
  max: 0,
  mean: 0,
  dropped: 0,
  invalid: 0,
};

/** 最近秩法：p=95、n=10 → 第 10 个（升序）；空数组给 0 而不是 NaN */
export function percentile(sortedAsc: readonly number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const clamped = Math.min(100, Math.max(0, p));
  const rank = Math.max(1, Math.ceil((clamped / 100) * n));
  return sortedAsc[rank - 1] ?? 0;
}

export function summarize(values: readonly number[], dropped = 0, invalid = 0): LatencySnapshot {
  const count = values.length;
  if (count === 0) return { ...EMPTY_LATENCY, dropped, invalid };
  const sorted = [...values].sort((a, b) => a - b);
  let sum = 0;
  for (const v of values) sum += v;
  return {
    count,
    p50: round3(percentile(sorted, 50)),
    p95: round3(percentile(sorted, 95)),
    max: round3(sorted[count - 1] ?? 0),
    mean: round3(sum / count),
    dropped,
    invalid,
  };
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** 固定容量环形窗口 + 分位数快照 */
export class LatencyRecorder {
  readonly capacity: number;
  private readonly buf: number[];
  private next = 0;
  private filled = 0;
  private droppedTotal = 0;
  private invalidTotal = 0;

  // ⚠ 不用 TS 参数属性（constructor(readonly capacity)）：node --test 的类型剥离不支持，见 MEMORY
  constructor(capacity = 512) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.buf = new Array<number>(this.capacity);
  }

  /** 返回 true=收下，false=脏样本被拒（调用方无需再判，计数已并进来） */
  record(ms: number): boolean {
    if (!Number.isFinite(ms) || ms < 0) {
      this.invalidTotal += 1;
      return false;
    }
    if (this.filled === this.buf.length) this.droppedTotal += 1; // 环形覆盖旧样本
    this.buf[this.next] = ms;
    this.next = (this.next + 1) % this.buf.length;
    if (this.filled < this.buf.length) this.filled += 1;
    return true;
  }

  get size(): number {
    return this.filled;
  }
  get dropped(): number {
    return this.droppedTotal;
  }
  get invalid(): number {
    return this.invalidTotal;
  }

  /** 窗口内样本（**写入序**，未排序；写满回绕后从最旧位置环形展开，保证「尾部=最近样本」） */
  values(): number[] {
    if (this.filled < this.buf.length) return this.buf.slice(0, this.filled);
    return [...this.buf.slice(this.next), ...this.buf.slice(0, this.next)];
  }

  snapshot(): LatencySnapshot {
    return summarize(this.values(), this.droppedTotal, this.invalidTotal);
  }

  reset(): void {
    this.next = 0;
    this.filled = 0;
    this.droppedTotal = 0;
    this.invalidTotal = 0;
  }
}

/** 跨进程/跨对话合并：各窗口样本拼起来后只保留最近 capacity 个（丢弃最旧，与环形语义一致） */
export function mergeRecorders(list: readonly LatencyRecorder[], capacity = 512): LatencySnapshot {
  const merged: number[] = [];
  let dropped = 0;
  let invalid = 0;
  for (const r of list) {
    merged.push(...r.values());
    dropped += r.dropped;
    invalid += r.invalid;
  }
  return summarize(merged.slice(-Math.max(1, Math.floor(capacity))), dropped, invalid);
}

/**
 * 红线预算（毫秒，p95 口径）。数值沿用 §7.9 性能红线表原预算，**改这里等于改红线**，
 * 必须同步文档；探针与面板都从这份常量取数，避免「文档写 20、代码判 30」。
 */
export const LATENCY_BUDGETS = {
  /** main→child→main 一次命令往返（ping/getState 类只读命令） */
  rpcRttP95Ms: 40,
  /** child 发帧→main 收到（事件两跳里的第一跳，跨进程 epoch 时间戳） */
  eventHopP95Ms: 20,
  /** child 发起 host:approval→拿到裁决（child 单时钟自计，无跨进程偏差） */
  approvalRttP95Ms: 40,
  /** 切到已存在对话 → 该对话首帧提交（渲染层自计） */
  firstPaintP95Ms: 100,
} as const;

export type LatencyBudgetKey = keyof typeof LATENCY_BUDGETS;

export interface BudgetVerdict {
  ok: boolean;
  note: string;
}

/** 达标判定：无样本一律不通过（并说明是哪条路径没被触发），有样本比 p95 */
export function budgetVerdict(snapshot: LatencySnapshot, budgetMs: number, label: string): BudgetVerdict {
  if (snapshot.count === 0) {
    return { ok: false, note: `${label}：无样本（本轮未触发该路径），不判达标` };
  }
  const ok = snapshot.p95 <= budgetMs;
  return {
    ok,
    note: `${label}：p95=${snapshot.p95}ms（预算 ≤${budgetMs}ms，n=${snapshot.count}${
      snapshot.invalid > 0 ? `，拒收脏样本 ${snapshot.invalid}` : ""
    }${snapshot.dropped > 0 ? `，窗口覆盖 ${snapshot.dropped}` : ""}）`,
  };
}

/**
 * 哪些下行命令的往返算「RPC 延迟」：只统计**不含模型耗时**的只读/轻量命令。
 * prompt/steer/followUp/start/compact 的往返里混着模型与装配时间，塞进同一张直方图
 * 会把 p95 抬到秒级、把红线判成不可能达标——那是量错东西，不是量超了。
 */
export const RPC_LATENCY_SAMPLED_METHODS: readonly EngineRpcMethod[] = [
  "ping",
  "getState",
  "getSessionId",
  "getRuntimeInfo",
  "getAvailableModels",
  "getAvailableThinkingLevels",
  "listCommands",
  "stats",
];

const SAMPLED = new Set<string>(RPC_LATENCY_SAMPLED_METHODS);

export function isRpcLatencySampled(method: string): boolean {
  return SAMPLED.has(method);
}

export interface LatencyReport {
  /** 下行只读命令 main→child→main 往返 */
  rpcRtt: LatencySnapshot;
  /** 上行事件帧 child→main 单跳 */
  eventHop: LatencySnapshot;
  /** child 自计的 host:approval / guard-tool 往返 */
  approvalRtt: LatencySnapshot;
  /** 宿主工具反向执行往返（含宿主真干活的时间，只展示不判红线） */
  hostToolRtt: LatencySnapshot;
}

export function emptyLatencyReport(): LatencyReport {
  return {
    rpcRtt: { ...EMPTY_LATENCY },
    eventHop: { ...EMPTY_LATENCY },
    approvalRtt: { ...EMPTY_LATENCY },
    hostToolRtt: { ...EMPTY_LATENCY },
  };
}

/** 人读一行摘要（探针输出与资源行共用） */
export function formatLatencyReport(r: LatencyReport): string {
  const one = (label: string, s: LatencySnapshot): string =>
    `${label} p50=${s.p50} p95=${s.p95} max=${s.max} n=${s.count}`;
  return [one("rpcRtt", r.rpcRtt), one("eventHop", r.eventHop), one("approvalRtt", r.approvalRtt), one("hostTool", r.hostToolRtt)].join(" | ");
}
