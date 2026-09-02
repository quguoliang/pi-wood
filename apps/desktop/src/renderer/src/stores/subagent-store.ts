import { create } from "zustand";
import type { SubagentRunInfo } from "@pi-wood/ipc-schema";

/**
 * T6.3 子代理运行时状态 store。数据源 = 主进程订阅 vendored `runs` 注册表后推送的快照
 * （engine:subagentRuns），面板挂载时先 `refresh()` 拉一次初值（engine:subagentList）。
 * 不做子会话事件拦截（child print 模式 tool_call 不上浮，见 §7.5 偏差）。
 */
interface SubagentState {
  runs: SubagentRunInfo[];
  setRuns: (runs: SubagentRunInfo[]) => void;
  /** 主动拉一次快照（面板挂载 / 无推送时兜底）。 */
  refresh: () => Promise<void>;
  clear: () => void;
}

export const useSubagentStore = create<SubagentState>((set) => ({
  runs: [],
  setRuns: (runs) => set({ runs }),
  refresh: async () => {
    try {
      const runs = await window.pi.subagentList();
      set({ runs: Array.isArray(runs) ? runs : [] });
    } catch {
      /* 引擎未就绪等情况：保留上次 */
    }
  },
  clear: () => set({ runs: [] }),
}));
