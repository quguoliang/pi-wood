// 主进程专用入口：SdkAdapter 实际加载 Pi SDK（运行时动态 import）
export { SdkAdapter } from "./sdk-adapter";
export { normalizeEngineEvent } from "./event-bridge";
export type { EngineAdapter, EngineStartOptions, DesktopUiBridge } from "./adapter";
