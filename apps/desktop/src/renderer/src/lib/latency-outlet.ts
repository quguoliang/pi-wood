/**
 * 渲染层度量出口（T8.10 · 红线「事件两跳第二跳 / 切换首屏 / 流式掉帧」）
 *
 * 这三件事只有渲染层自己测得准：主进程不知道帧什么时候真的画出来。
 * 样本在本地攒成批，每 ~2s 经 `engine:reportLatency` 送一次给主进程入环形窗口——
 * **每帧一次 IPC 会让度量本身变成性能问题**，那测出来的数就没有意义了。
 *
 * 三条纪律：
 * 1. **只在有活动时开表**：rAF 循环只在「最近 600ms 内来过事件」且窗口可见时跑，空闲即停；
 *    否则就是拿一个常驻 60fps 循环去测「卡不卡」，自己先把 CPU 吃出红线。
 * 2. **窗口不可见时不采帧间隔**：浏览器会节流 rAF，测出来的 1000ms「掉帧」是节流不是渲染慢。
 * 3. **度量不许影响功能**：全程 `typeof window/document/performance` 守卫 + 上报 fire-and-forget，
 *    桥不存在（单测环境、旧 preload）就整体退化成 no-op。
 *
 * ⚠ 时基：`nowEpochMs()`（跨进程可比）用于第二跳与首屏；rAF 回调给的是 `performance.now()` 时基，
 * 帧表判停用同一时基比对——混用会把「空闲」永远判成「刚活动过」。
 */

import { nowEpochMs } from "@pi-wood/ipc-schema";

/** 空闲多久后停掉 rAF 帧表（ms）。比一轮 token 间隔长、比一次对话间隔短。 */
export const FRAME_WATCH_IDLE_MS = 600;
/** 批量上报周期（ms）。 */
export const FLUSH_INTERVAL_MS = 2000;
/** 单批上限（与主进程 clampSamples 的默认一致）。 */
const BATCH_CAP = 512;
/** 超过这个跨度的样本视为窗口挂起/时钟跳变，不进统计（ms）。 */
const OUTLIER_MS = 5000;

/** 纯函数：帧表是否该继续跑（单测盯住这条，别让它变成常驻循环） */
export function shouldWatchFrames(now: number, lastActivityAt: number, visible: boolean): boolean {
  if (!visible) return false;
  return now - lastActivityAt < FRAME_WATCH_IDLE_MS;
}

/** 纯函数：样本是否可信（非有限、负值、离群值一律不入窗） */
export function isPlausibleSample(ms: number): boolean {
  return Number.isFinite(ms) && ms >= 0 && ms < OUTLIER_MS;
}

/** 纯函数：取走一批（保留最近的 BATCH_CAP 个）并清空缓冲 */
export function takeBatch(buf: number[], cap = BATCH_CAP): number[] {
  if (buf.length === 0) return [];
  const out = buf.slice(-cap);
  buf.length = 0;
  return out;
}

let hop: number[] = [];
let paint: number[] = [];
let gap: number[] = [];
let lastActivityPerf = 0; // performance.now() 时基（帧表判停用）
let switchStartAt = 0; // nowEpochMs() 时基（首屏用）
let rafId: number | null = null;
let lastFrameAt = 0;
let flushTimer: ReturnType<typeof setInterval> | undefined;
let started = false;

const perfNow = (): number => (typeof performance === "undefined" ? Date.now() : performance.now());
const isVisible = (): boolean => (typeof document === "undefined" ? true : document.visibilityState !== "hidden");

function markActivity(): void {
  lastActivityPerf = perfNow();
}

/** 有事件到达：记「main→renderer」第二跳样本并把帧表叫醒 */
export function noteEventArrival(tPush?: number): void {
  if (!started) return;
  markActivity();
  if (typeof tPush === "number") {
    const d = nowEpochMs() - tPush;
    if (isPlausibleSample(d)) hop.push(d);
  }
  ensureFrameWatch();
}

/** 用户点标签切对话：记下起点，等首帧提交时配平 */
export function markSwitchStart(): void {
  if (!started) return;
  switchStartAt = nowEpochMs();
}

/** 切换后的首次提交（App 在 activeConversationId 变化的 effect 里、rAF 回调内调） */
export function noteSwitchPainted(): void {
  if (!started || switchStartAt === 0) return;
  const d = nowEpochMs() - switchStartAt;
  switchStartAt = 0;
  if (isPlausibleSample(d)) paint.push(d);
}

function ensureFrameWatch(): void {
  if (typeof requestAnimationFrame !== "function" || rafId !== null) return;
  const tick = (t: number): void => {
    if (!shouldWatchFrames(t, lastActivityPerf, isVisible())) {
      rafId = null;
      lastFrameAt = 0;
      return; // 空闲/不可见 → 停表，绝不留常驻循环
    }
    if (lastFrameAt > 0) {
      const d = t - lastFrameAt;
      if (isPlausibleSample(d)) gap.push(d);
    }
    lastFrameAt = t;
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function flush(): void {
  if (!started) return;
  const bHop = takeBatch(hop);
  const bPaint = takeBatch(paint);
  const bGap = takeBatch(gap);
  if (bHop.length + bPaint.length + bGap.length === 0) return;
  try {
    window.pi.reportLatency?.({ rendererHopMs: bHop, firstPaintMs: bPaint, frameGapMs: bGap, visible: isVisible() });
  } catch {
    /* 度量上报失败绝不影响功能 */
  }
}

/** App 挂载时调用一次；重复调用无副作用 */
export function startLatencyOutlet(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  markActivity();
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
}

/** 卸载时停表（探针跑完退出、或将来多窗口化时避免双份样本） */
export function stopLatencyOutlet(): void {
  if (!started) return;
  started = false;
  if (flushTimer !== undefined) clearInterval(flushTimer);
  flushTimer = undefined;
  if (rafId !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
  rafId = null;
  lastFrameAt = 0;
  hop = [];
  paint = [];
  gap = [];
  switchStartAt = 0;
  lastActivityPerf = 0;
}

/** 本地只读视图（调试用；不依赖主进程往返） */
export function localOutletView(): { hop: number; paint: number; gap: number; watching: boolean; started: boolean } {
  return { hop: hop.length, paint: paint.length, gap: gap.length, watching: rafId !== null, started };
}
