import { create } from "zustand";

/**
 * 会话 store（T1.3）：消费引擎归一化事件流，维护 UIMessage 列表与流式状态。
 * 消息形态对齐方案 §8.3（简化：assistant 流式期间用 streamBuffer，message_end 落一条）。
 */
export type UIMessage =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "tool"; toolCallId: string; toolName: string; status: "running" | "ok" | "error" }
  | { id: string; kind: "system"; text: string };

interface SessionState {
  messages: UIMessage[];
  streamBuffer: string;
  streaming: boolean;
  activeProject: string | undefined;
  engineReady: boolean;
  handleEvent(e: Record<string, unknown>): void;
  addUserMessage(text: string): void;
  loadMessages(items: Array<{ role: string; text: string }>): void;
  reset(): void;
  setActiveProject(projectDir: string | undefined): void;
  setEngineReady(ready: boolean): void;
}

let seq = 0;
const nextId = (): string => `m${++seq}`;

export const useSessionStore = create<SessionState>((set, get) => ({
  messages: [],
  streamBuffer: "",
  streaming: false,
  activeProject: undefined,
  engineReady: false,

  handleEvent(e) {
    const type = e.type as string;
    if (type === "user_message") {
      get().addUserMessage(e.text as string);
      return;
    }
    if (type === "agent_start") {
      set({ streaming: true });
      return;
    }
    if (type === "agent_end" || type === "agent_settled") {
      set({ streaming: false });
      return;
    }
    if (type === "message_update") {
      const inner = e.assistantMessageEvent as
        | { type?: string; delta?: unknown; text?: unknown }
        | undefined;
      if (inner?.type === "text_delta") {
        const delta = typeof inner.delta === "string" ? inner.delta : typeof inner.text === "string" ? inner.text : "";
        if (delta) set({ streamBuffer: get().streamBuffer + delta });
      }
      return;
    }
    if (type === "message_end") {
      // 流式正文落盘为一条 assistant 消息；空文本（纯工具轮次）跳过
      const buf = get().streamBuffer;
      if (buf.trim()) {
        set({
          messages: [...get().messages, { id: nextId(), kind: "assistant", text: buf }],
          streamBuffer: "",
        });
      } else {
        set({ streamBuffer: "" });
      }
      return;
    }
    if (type === "tool_execution_start") {
      set({
        messages: [
          ...get().messages,
          {
            id: nextId(),
            kind: "tool",
            toolCallId: String(e.toolCallId ?? `t${Date.now()}`),
            toolName: String(e.toolName ?? "unknown"),
            status: "running",
          },
        ],
      });
      return;
    }
    if (type === "tool_execution_end") {
      const callId = String(e.toolCallId ?? "");
      set({
        messages: get().messages.map((m) =>
          m.kind === "tool" && m.toolCallId === callId
            ? { ...m, status: e.isError ? ("error" as const) : ("ok" as const) }
            : m,
        ),
      });
      return;
    }
    if (type === "compaction_end") {
      set({
        messages: [
          ...get().messages,
          { id: nextId(), kind: "system", text: "上下文已压缩" },
        ],
      });
    }
  },

  addUserMessage(text) {
    set({ messages: [...get().messages, { id: nextId(), kind: "user", text }], streamBuffer: "" });
  },

  loadMessages(items) {
    set({
      messages: items.map((m) => ({
        id: nextId(),
        kind: m.role === "user" ? ("user" as const) : m.role === "assistant" ? ("assistant" as const) : ("system" as const),
        text: m.text,
      })),
      streamBuffer: "",
      streaming: false,
    });
  },

  reset() {
    set({ messages: [], streamBuffer: "", streaming: false });
  },

  setActiveProject(projectDir) {
    set({ activeProject: projectDir });
  },

  setEngineReady(ready) {
    set({ engineReady: ready });
  },
}));
