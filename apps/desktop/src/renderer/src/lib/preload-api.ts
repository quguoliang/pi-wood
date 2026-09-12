/**
 * preload 能力的显式断言。
 *
 * 渲染层调 `window.pi.*` 有两个都必须避开的坑：
 *
 * 1. **不能直接调 `window.pi.fsImage(...)` 就完事**：方法不存在时抛的是**同步 TypeError**，
 *    它发生在 promise 构造之前 ⇒ 链在后面的 `.catch()` **根本收不到**。若这个调用位于
 *    effect／render 顶层（而不是事件回调里），异常会逃进 React 把整块面板打成**白屏**。
 *    真机报障（2026-09-12）：改了 preload 但 Electron 进程没重启，`FilesPanel` 直接白屏——
 *    preload 只在窗口创建时加载一次，渲染层热更新覆盖不到它。
 * 2. **也不能写成 `window.pi.fsImage?.(...)`**：可选链在缺失时是**空操作且不报错**，上层的
 *    成功分支照跑，把「没接线」伪装成「已成功」（先例：`sessionsDelete?.()` 造成
 *    「UI 说已删除、文件仍留在盘上」）。
 *
 * 所以口径是**响亮但可见**：这里抛，由调用方收敛成界面上的状态文案／toast，
 * 而不是既静默（可选链）也不可见（未捕获异常）。
 *
 * 用法：
 * ```ts
 * try {
 *   load = requirePi(window.pi.fsImage, "fsImage")(p).then(...);
 * } catch (err) {
 *   setStatus(err instanceof Error ? err.message : String(err)); // 收敛成可见状态
 * }
 * ```
 */
export function requirePi<T>(fn: T, name: string): T {
  if (typeof fn !== "function") {
    throw new Error(`preload 未提供 ${name}：请重启应用（preload 只在窗口创建时加载一次，热更新覆盖不到它）`);
  }
  return fn;
}
