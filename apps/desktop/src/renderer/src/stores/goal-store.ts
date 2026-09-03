import { create } from "zustand";
import type { GoalState } from "@pi-wood/ipc-schema";

/**
 * T7.5 目标模式渲染层 store。
 * - goal：当前会话的目标状态（无则 null）。
 * - arm：Composer「作为目标发送」开关——开启后本次输入成为目标并 kickoff（由 Composer 发送逻辑消费）。
 */
interface GoalStoreState {
  goal: GoalState | null;
  arm: boolean;
  setArm: (on: boolean) => void;
  load: (sessionId: string) => Promise<void>;
  set: (sessionId: string, objective: string, opts?: { tokenBudget?: number; maxTurns?: number }) => Promise<void>;
  pause: (sessionId: string) => Promise<void>;
  resume: (sessionId: string) => Promise<void>;
  clear: (sessionId: string) => Promise<void>;
  applyStatus: (state: GoalState | null) => void;
}

export const useGoalStore = create<GoalStoreState>((set) => ({
  goal: null,
  arm: false,
  setArm: (on) => set({ arm: on }),
  load: async (sessionId) => {
    if (!sessionId) return set({ goal: null });
    set({ goal: await window.pi.goalGet(sessionId) });
  },
  set: async (sessionId, objective, opts) => {
    const state = await window.pi.goalSet(sessionId, objective, opts);
    set({ goal: state, arm: false });
  },
  pause: async (sessionId) => set({ goal: await window.pi.goalPause(sessionId) }),
  resume: async (sessionId) => set({ goal: await window.pi.goalResume(sessionId) }),
  clear: async (sessionId) => {
    await window.pi.goalClear(sessionId);
    set({ goal: null });
  },
  applyStatus: (state) => set({ goal: state }),
}));
