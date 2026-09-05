import type { LatencySnapshot, RendererLatencyPayload } from "@pi-wood/ipc-schema";
import { EMPTY_LATENCY, clampSamples, cpuPercentFromDelta, summarize } from "@pi-wood/ipc-schema";

/**
 * 渲染层自测样本的宿主侧汇聚点（T8.10 · 红线「事件两跳 / 切换首屏 / 掉帧 / 主进程 CPU」）。
 *
 * 为什么样本要绕一圈上报：rendererHop / firstPaint / frameGap 只有渲染层自己测得到，
 * 而红线判定与探针输出都在主进程。渲染层**批量**（每 ~2s）经 `engine:reportLatency` 送上来，
 * 主进程入同一组环形窗口——每帧一次 IPC 会让度量本身变成性能问题，那就本末倒置了。
 *
 * 三条纪律：
 * 1. **度量不许影响功能**：载荷非法只计数（`rejectedBatches`）并返回，绝不抛进 handler；
 * 2. **CPU 只在有活动的窗口里记**：一批样本都没有 = 空闲，记进去会把「流式期间 ≤60%」稀释成好看；
 * 3. **窗口可见性由上报方带**：不可见时 rAF 被节流，帧间隔样本无意义（渲染层那边已按可见性停表）。
 */

/** 轻量包装：只暴露 recordMany/snapshot/reset，避免外部误改窗口 */
class SampleWindow {
  private readonly values: number[] = [];
  private dropped = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }
  recordMany(list: readonly number[]): void {
    for (const v of list) {
      if (this.values.length >= this.capacity) {
        this.values.shift();
        this.dropped += 1;
      }
      this.values.push(v);
    }
  }
  snapshot(): LatencySnapshot {
    return summarize(this.values, this.dropped, 0);
  }
  reset(): void {
    this.values.length = 0;
    this.dropped = 0;
  }
}

const rendererHop = new SampleWindow(2048);
const firstPaint = new SampleWindow(256);
const frameGap = new SampleWindow(4096);
const mainCpu = new SampleWindow(256);

let lastCpu = process.cpuUsage();
let lastAt = Date.now();
let rejectedBatches = 0;
let reportedSamples = 0;

/** 主进程 handler 的唯一入口：清洗 → 入窗 → 顺带算这一段的 CPU 占比（只在有样本的窗口算） */
export function noteRendererSamples(payload: RendererLatencyPayload): void {
  const hop = clampSamples(payload.rendererHopMs);
  const paint = clampSamples(payload.firstPaintMs);
  const gap = payload.visible === false ? [] : clampSamples(payload.frameGapMs); // 不可见时的帧间隔不采信
  const active = hop.length + paint.length + gap.length;
  reportedSamples += active;

  const now = Date.now();
  const elapsedMs = now - lastAt;
  const cpu = process.cpuUsage(lastCpu);
  lastCpu = process.cpuUsage();
  lastAt = now;
  if (active > 0 && elapsedMs > 0) mainCpu.recordMany([cpuPercentFromDelta(cpu.user + cpu.system, elapsedMs)]);

  rendererHop.recordMany(hop);
  firstPaint.recordMany(paint);
  frameGap.recordMany(gap);
}

export interface RendererLatencyView {
  rendererHop: LatencySnapshot;
  firstPaint: LatencySnapshot;
  frameGap: LatencySnapshot;
  mainCpuPct: LatencySnapshot;
  /** 被拒收的批次计数（载荷非法）——非 0 说明渲染层与主进程版本不同步 */
  rejectedBatches: number;
  /** 累计收到的样本数（判「是不是根本没在测」用） */
  reportedSamples: number;
}

export function rendererLatencyView(): RendererLatencyView {
  return {
    rendererHop: rendererHop.snapshot(),
    firstPaint: firstPaint.snapshot(),
    frameGap: frameGap.snapshot(),
    mainCpuPct: mainCpu.snapshot(),
    rejectedBatches,
    reportedSamples,
  };
}

/** 探针跑前的清零（否则上一轮的分位数会污染本轮判定）；面板不需要调它 */
export function resetRendererLatency(): void {
  rendererHop.reset();
  firstPaint.reset();
  frameGap.reset();
  mainCpu.reset();
  rejectedBatches = 0;
  reportedSamples = 0;
  lastCpu = process.cpuUsage();
  lastAt = Date.now();
}

export function noteRejectedBatch(reason: string): void {
  rejectedBatches += 1;
  if (rejectedBatches === 1 || rejectedBatches % 50 === 0) {
    console.warn(`[latency] 渲染层度量载荷非法（累计 ${rejectedBatches} 批）：${reason}`);
  }
}

/** 空快照（供 IPC 在异常路径上返回，别返回 undefined 让渲染层猜） */
export const emptyRendererLatencyView = (): RendererLatencyView => ({
  rendererHop: { ...EMPTY_LATENCY },
  firstPaint: { ...EMPTY_LATENCY },
  frameGap: { ...EMPTY_LATENCY },
  mainCpuPct: { ...EMPTY_LATENCY },
  rejectedBatches: 0,
  reportedSamples: 0,
});
