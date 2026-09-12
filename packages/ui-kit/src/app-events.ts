/**
 * 渲染层内部的「跨层交互事件」名单。
 *
 * 为什么需要这个文件：`@pi-wood/ui-kit` 是**无状态展示库**——它不知道工作台 store、
 * 不知道右栏面板，也不该依赖它们（否则包被别处复用时会被迫拖上整个应用状态）。
 * 但界面上确实有「卡片里点一下 → 打开应用某块面板」的需求，于是约定为
 * **派发 window 事件**：ui-kit 只负责派发，应用侧（App.tsx）监听后翻译成 store 动作。
 *
 * 事件名必须从这里取，不要在两侧各写一遍裸串——裸串写错的表现是「点了没反应」，
 * 类型检查与测试都拦不住（先例：`window.pi.xxx?.()` 把「没接线」伪装成「已成功」）。
 */

/** 点击工具卡里的文件路径 → 打开右栏文件面板并定位到该行。detail: `{ path: string; line?: number }` */
export const OPEN_FILE_EVENT = "piwood:open-file";

/** 点击「打开子代理会话」→ 选中该 run 并打开子代理面板。detail: `{ runId: string }` */
export const OPEN_SUBAGENT_EVENT = "piwood:open-subagent";
