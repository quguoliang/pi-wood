import { create } from "zustand";

/**
 * T5.6 全局「展开/收起所有工具组」——内存态，不持久化，刷新后各组恢复各自 defaultOpen。
 * nonce 每次自增，ToolGroup 订阅 nonce 变化后把自身 open 同步为 allOpen（一次性应用，
 * 之后仍可单独点组头折叠/展开，不被锁定）。
 */
interface ToolGroupsState {
  allOpen: boolean;
  nonce: number;
  /** Ctrl+Shift+E：在「全部展开」与「全部收起」之间切换。 */
  toggleAll: () => void;
}

export const useToolGroupsStore = create<ToolGroupsState>((set) => ({
  allOpen: false,
  nonce: 0,
  toggleAll: () => set((s) => ({ allOpen: !s.allOpen, nonce: s.nonce + 1 })),
}));
