// 主进程专用入口：SdkAdapter 实际加载 Pi SDK（运行时动态 import）
export { SdkAdapter } from "./sdk-adapter";
// T8.1：主进程侧跨进程实现（不 import Pi SDK，能力全走注入的帧传输；引擎子进程内用 SdkAdapter）
export { RemoteEngineAdapter, type EngineTransport } from "./remote-adapter";
export { normalizeEngineEvent } from "./event-bridge";
export type {
  AvailableModel,
  DesktopUiBridge,
  EngineAdapter,
  EngineSessionRef,
  EngineStartInfo,
  EngineStartOptions,
} from "./adapter";
