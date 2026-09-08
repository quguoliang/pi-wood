/**
 * T9.2 v2.2 阅读锚点总线：MessageList 的 scroll-spy（当前可见轮次）→ 刻度条/缩略树等导航附加物。
 *
 * 为什么不用 window CustomEvent：MessageList 与 MessageMinimap 是同层兄弟，effect 按挂载顺序执行——
 * 首帧锚点（短对话根本不会再触发 scroll，因此可能只此一次）会在刻度条挂上监听**之前**发完，
 * 晚到的订阅者永远错过。总线缓存最后一个值，订阅即刻回放，顺序无关。
 *
 * 纯逻辑、无 DOM、可被 node --test 直接跑。
 */

export type OutlineAnchorListener = (itemId: string | undefined) => void;

let current: string | undefined;
const listeners = new Set<OutlineAnchorListener>();

/** 发布当前阅读锚点（MessageList 行 id；undefined=暂无锚点）。同值自动去重，不重复回放。 */
export function publishOutlineAnchor(itemId: string | undefined): void {
  if (itemId === current) return;
  current = itemId;
  for (const listener of listeners) listener(itemId);
}

/** 读取最后一个锚点（晚挂载的消费者用）。 */
export function getOutlineAnchor(): string | undefined {
  return current;
}

/**
 * 订阅锚点变化。返回取消订阅函数。
 * ⚠ 订阅时会立即用当前值回放一次，因此消费者无需再单独取初值。
 */
export function subscribeOutlineAnchor(listener: OutlineAnchorListener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

/** 仅供测试：清空总线状态。 */
export function resetOutlineAnchorForTest(): void {
  current = undefined;
  listeners.clear();
}
