import { create } from "zustand";
import type { RuntimeInfo } from "@pi-wood/ipc-schema";

/**
 * 运行时信息 store：EnvironmentPanel 的数据源。
 * - info：主进程聚合的 RuntimeInfo（Pi 会话真实状态 + git 信息），所有区块可选；
 * - tasks：渲染层从 tool_execution_* 事件推导的运行中任务（Pi 无内建子代理/plan API，
 *   运行中的工具调用即当前任务的执行步骤；若 agent 产出 plan 内容则记录在 planText）。
 */
export interface RunningTask {
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
}

interface RuntimeState {
  info: RuntimeInfo | undefined;
  tasks: RunningTask[];
  planText: string | undefined;
  refresh(): Promise<void>;
  trackEvent(e: Record<string, unknown>): void;
  reset(): void;
}

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  info: undefined,
  tasks: [],
  planText: undefined,

  async refresh() {
    try {
      const info = await window.pi.runtimeInfo();
      set({ info });
    } catch {
      set({ info: undefined });
    }
  },

  trackEvent(e) {
    const type = e.type as string;
    if (type === "tool_execution_start") {
      const task: RunningTask = {
        toolCallId: String(e.toolCallId ?? `t${Date.now()}`),
        toolName: String(e.toolName ?? "unknown"),
        input:
          e.input !== null && typeof e.input === "object" && !Array.isArray(e.input)
            ? (e.input as Record<string, unknown>)
            : undefined,
      };
      set({ tasks: [...get().tasks, task] });
      return;
    }
    if (type === "tool_execution_end") {
      const callId = String(e.toolCallId ?? "");
      set({ tasks: get().tasks.filter((t) => t.toolCallId !== callId) });
      return;
    }
    if (type === "agent_start") {
      set({ tasks: [], planText: undefined });
      return;
    }
    if (type === "agent_end" || type === "agent_settled") {
      set({ tasks: [] });
      void get().refresh();
      return;
    }
    if (type === "model_changed" || type === "thinking_level_changed" || type === "compaction_end") {
      void get().refresh();
    }
  },

  reset() {
    set({ info: undefined, tasks: [], planText: undefined });
  },
}));
