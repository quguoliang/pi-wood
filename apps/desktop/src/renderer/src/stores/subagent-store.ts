import { create } from "zustand";
import type { SubagentRunInfo } from "@pi-wood/ipc-schema";

/**
 * T6.3/T6.5 子代理 store。
 * - runs：来自 vendored runs 注册表快照（engine:subagentRuns 推送 / subagentList 拉取）。
 * - itemsByRun：把 child 会话事件（engine:subagentEvent，主进程已 normalize）归约成
 *   只读转录本。用**独立、精简**的 reducer（不动 session-store，避免影响主链路）。
 */
export interface SubagentItem {
  id: string;
  kind: "user" | "assistant" | "thinking" | "tool";
  text?: string;
  toolCallId?: string;
  name?: string;
  status?: "running" | "ok" | "error";
  output?: string;
}

interface SubagentState {
  runs: SubagentRunInfo[];
  itemsByRun: Record<string, SubagentItem[]>;
  setRuns: (runs: SubagentRunInfo[]) => void;
  refresh: () => Promise<void>;
  handleEvent: (runId: string, event: Record<string, unknown>) => void;
  clear: () => void;
}

let itemSeq = 0;
const nextItemId = (): string => `sa-${Date.now().toString(36)}-${itemSeq++}`;

/** 把一条归一后的 EngineEvent 折叠进某 run 的只读转录本。 */
function reduce(items: SubagentItem[], e: Record<string, unknown>): SubagentItem[] {
  const type = e.type as string;
  const out = [...items];
  const last = out[out.length - 1];

  switch (type) {
    case "user_message": {
      const text = typeof e.text === "string" ? e.text : "";
      if (text) out.push({ id: nextItemId(), kind: "user", text });
      return out;
    }
    case "message_update": {
      const a = e.assistantMessageEvent as { type?: string; delta?: unknown } | undefined;
      if (!a) return out;
      const piece = typeof a.delta === "string" ? a.delta : "";
      if (!piece) return out;
      if (a.type === "text_delta") {
        if (last && last.kind === "assistant") out[out.length - 1] = { ...last, text: (last.text ?? "") + piece };
        else out.push({ id: nextItemId(), kind: "assistant", text: piece });
      } else if (a.type === "thinking_delta") {
        if (last && last.kind === "thinking") out[out.length - 1] = { ...last, text: (last.text ?? "") + piece };
        else out.push({ id: nextItemId(), kind: "thinking", text: piece });
      }
      return out;
    }
    case "tool_execution_start": {
      out.push({
        id: nextItemId(),
        kind: "tool",
        toolCallId: typeof e.toolCallId === "string" ? e.toolCallId : nextItemId(),
        name: typeof e.toolName === "string" ? e.toolName : "tool",
        status: "running",
      });
      return out;
    }
    case "tool_execution_update": {
      const id = e.toolCallId as string | undefined;
      const idx = out.findIndex((i) => i.kind === "tool" && i.toolCallId === id);
      if (idx >= 0 && typeof e.output === "string") out[idx] = { ...out[idx], output: (out[idx].output ?? "") + e.output };
      return out;
    }
    case "tool_execution_end": {
      const id = e.toolCallId as string | undefined;
      const idx = out.findIndex((i) => i.kind === "tool" && i.toolCallId === id);
      if (idx >= 0) out[idx] = { ...out[idx], status: e.isError ? "error" : "ok" };
      return out;
    }
    default:
      return out;
  }
}

export const useSubagentStore = create<SubagentState>((set, get) => ({
  runs: [],
  itemsByRun: {},
  setRuns: (runs) => set({ runs }),
  refresh: async () => {
    try {
      const runs = await window.pi.subagentList();
      set({ runs: Array.isArray(runs) ? runs : [] });
    } catch {
      /* 引擎未就绪：保留上次 */
    }
  },
  handleEvent: (runId, event) => {
    const prev = get().itemsByRun[runId] ?? [];
    const next = reduce(prev, event);
    if (next !== prev) set((s) => ({ itemsByRun: { ...s.itemsByRun, [runId]: next } }));
  },
  clear: () => set({ runs: [], itemsByRun: {} }),
}));
