// 渲染层可安全引用的入口：仅类型与接口，不引入 Node 依赖。
// SdkAdapter（含 Pi SDK 动态导入）经 "@pidesk/engine/sdk" 子路径供主进程使用。
export type {
  EngineAdapter,
  EngineStartOptions,
  DesktopUiBridge,
  AvailableModel,
} from "./adapter";
export type { EngineEvent } from "@pidesk/ipc-schema";
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
