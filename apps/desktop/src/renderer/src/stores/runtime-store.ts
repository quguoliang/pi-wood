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

/** rpiv-todo 的任务项（仅取渲染所需字段；快照来自 todo 工具 result.details.tasks） */
export interface TodoItem {
  id: number;
  subject: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  activeForm?: string;
  blockedBy?: number[];
}

/**
 * 从 tool_execution_end 的 result 提取 todo 全量快照。
 * 判据用特征（details.tasks 为带 id+status 的对象数组）而非工具名，
 * 与 rpiv-todo 版本解耦——它每次成功调用都回传全量 tasks，渲染层无需自跑 reducer。
 */
function extractTodoSnapshot(result: unknown): TodoItem[] | undefined {
  const tasks = (result as { details?: { tasks?: unknown } } | undefined)?.details?.tasks;
  if (!Array.isArray(tasks)) return undefined;
  const parsed: TodoItem[] = [];
  for (const t of tasks) {
    if (!t || typeof t !== "object") continue;
    const item = t as Record<string, unknown>;
    if (typeof item.id !== "number" || typeof item.status !== "string") continue;
    parsed.push({
      id: item.id,
      subject: typeof item.subject === "string" ? item.subject : "",
      status: item.status as TodoItem["status"],
      activeForm: typeof item.activeForm === "string" ? item.activeForm : undefined,
      blockedBy: Array.isArray(item.blockedBy) ? (item.blockedBy as number[]) : undefined,
    });
  }
  return parsed;
}

interface RuntimeState {
  info: RuntimeInfo | undefined;
  tasks: RunningTask[];
  todos: TodoItem[];
  planText: string | undefined;
  refresh(): Promise<void>;
  trackEvent(e: Record<string, unknown>): void;
  reset(): void;
}

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  info: undefined,
  tasks: [],
  todos: [],
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
          e.args !== null && typeof e.args === "object" && !Array.isArray(e.args)
            ? (e.args as Record<string, unknown>)
            : undefined,
      };
      set({ tasks: [...get().tasks, task] });
      return;
    }
    if (type === "tool_execution_end") {
      const callId = String(e.toolCallId ?? "");
      if (!e.isError) {
        const snapshot = extractTodoSnapshot(e.result);
        if (snapshot) set({ todos: snapshot });
      }
      set({ tasks: get().tasks.filter((t) => t.toolCallId !== callId) });
      return;
    }
    if (type === "agent_start") {
      // 仅清运行中的瞬时任务；todos 跨轮累积，只在 reset（切/新会话）时清
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
    set({ info: undefined, tasks: [], todos: [], planText: undefined });
  },
}));
