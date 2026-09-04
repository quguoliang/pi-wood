import { performance } from "node:perf_hooks";

/**
 * 关停运行时（T8.1 前置修复，与 D 方案无关但被 T8.1 的 suspend/close 依赖）。
 *
 * 为什么不能直接 `session.dispose()`（旧 stop() 的写法）：
 * Pi SDK 的 `AgentSessionRuntime.dispose()`（dist/core/agent-session-runtime.js 实测）
 * 先广播 `session_shutdown{reason:"quit"}` 给扩展，再 `session.dispose()`；
 * `session.dispose()` 单独调用**不会**触发 `session_shutdown` —— 依赖该事件回收外部资源的
 * 扩展（典型：MCP stdio 子进程、pi-subagents 的 child 会话）就此泄漏成孤儿进程树。
 *
 * 本文件刻意不 import Pi SDK / electron，以便 `node --test` 直接跑（见 runtime-dispose.test.ts）。
 */

export interface DisposableRuntime {
  dispose?(): Promise<void> | void;
  session?: {
    abort?(): Promise<void> | void;
    dispose?(): void;
  };
}

export type DisposeStep = "abort" | "abort-error" | "runtime.dispose" | "session.dispose";

export interface DisposeResult {
  steps: DisposeStep[];
  ms: number;
}

/**
 * 有序关停：`session.abort()`（先settled 在飞的一轮，与 SDK `teardownCurrent` 同序）
 * → `runtime.dispose()`（广播 session_shutdown）。
 * 老 SDK / stub 若没有 `runtime.dispose`，退回到 `session.dispose()` 并计数（可断言未静默丢事件）。
 */
export async function disposeRuntimeGracefully(rt: DisposableRuntime | undefined): Promise<DisposeResult> {
  const t0 = performance.now();
  const steps: DisposeStep[] = [];
  if (!rt) return { steps, ms: 0 };

  try {
    await rt.session?.abort?.();
    steps.push("abort");
  } catch {
    steps.push("abort-error"); // 中断失败不阻断关停（否则引擎切不开新项目）
  }

  if (typeof rt.dispose === "function") {
    await rt.dispose();
    steps.push("runtime.dispose");
  } else {
    rt.session?.dispose?.();
    steps.push("session.dispose");
  }
  return { steps, ms: Math.round(performance.now() - t0) };
}

/** 关停顺序断言用：session_shutdown 是否真的被广播（runtime.dispose 缺席 = 未广播）。 */
export function emittedSessionShutdown(result: DisposeResult): boolean {
  return result.steps.includes("runtime.dispose");
}
