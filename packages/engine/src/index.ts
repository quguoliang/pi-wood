// 渲染层可安全引用的入口：仅类型与接口，不引入 Node 依赖。
// SdkAdapter（含 Pi SDK 动态导入）经 "@pi-wood/engine/sdk" 子路径供主进程使用。
export type {
  EngineAdapter,
  EngineSessionRef,
  EngineStartInfo,
  EngineStartOptions,
  DesktopUiBridge,
  AvailableModel,
} from "./adapter";
export type { EngineEvent } from "@pi-wood/ipc-schema";
export type {
  TreeEntry,
  SessionTreeNode,
  SessionTree,
} from "./session-tree.ts";
export {
  buildSessionTree,
  defaultLeaf,
  flattenTree,
} from "./session-tree.ts";
// T6.5：主进程归一 child 会话原始事件用（纯函数，无 Node 依赖）。
export { normalizeEngineEvent } from "./event-bridge";
