import { create } from "zustand";

/**
 * 会话 store（T1.3）：消费引擎归一化事件流，维护 UIMessage 列表与流式状态。
 * 消息形态对齐方案 §8.3（简化：assistant 流式期间用 streamBuffer，message_end 落一条）。
 */
export type UIMessage =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      toolName: string;
      status: "running" | "ok" | "error";
      input?: Record<string, unknown>;
      output?: string;
    }
  | { id: string; kind: "system"; text: string };

interface SessionState {
  messages: UIMessage[];
  streamBuffer: string;
  streaming: boolean;
  activeProject: string | undefined;
  engineReady: boolean;
  handleEvent(e: Record<string, unknown>): void;
  addUserMessage(text: string): void;
  loadMessages(items: HistoryMessageItem[]): void;
  reset(): void;
  setActiveProject(projectDir: string | undefined): void;
  setEngineReady(ready: boolean): void;
}

export interface HistoryMessageItem {
  role: string;
  text: string;
  toolCallId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  isError?: boolean;
}

let seq = 0;
const nextId = (): string => `m${++seq}`;

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
};

/**
 * 把 Pi SDK 的工具结果解包成可读文本：
 * - content: [{type:"text", text}] 形态 → 直接拼接 text；
 * - error 形态的 Error 对象 → message；
 * - 其他对象 → 格式化的 JSON。
 */
const extractToolOutput = (result: unknown, isError: boolean): string | undefined => {
  if (result === undefined || result === null) return undefined;
  if (typeof result === "string") return result;
  if (isError && typeof (result as { message?: unknown }).message === "string") {
    return (result as { message: string }).message;
  }
  const content = (result as { content?: unknown }).content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        part !== null && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }
  if (typeof (result as { text?: unknown }).text === "string") return (result as { text: string }).text;
  return safeStringify(result);
};

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
      const input = e.input;
      set({
        messages: [
          ...get().messages,
          {
            id: nextId(),
            kind: "tool",
            toolCallId: String(e.toolCallId ?? `t${Date.now()}`),
            toolName: String(e.toolName ?? "unknown"),
            status: "running",
            input:
              input !== null && typeof input === "object" && !Array.isArray(input)
                ? (input as Record<string, unknown>)
                : input !== undefined
                  ? { value: input }
                  : undefined,
          },
        ],
      });
      return;
    }
    if (type === "tool_execution_update") {
      const callId = String(e.toolCallId ?? "");
      const chunk = typeof e.output === "string" ? e.output : "";
      if (!chunk) return;
      set({
        messages: get().messages.map((m) =>
          m.kind === "tool" && m.toolCallId === callId
            ? { ...m, output: (m.output ?? "") + chunk }
            : m,
        ),
      });
      return;
    }
    if (type === "tool_execution_end") {
      const callId = String(e.toolCallId ?? "");
      const result = e.result;
      set({
        messages: get().messages.map((m) => {
          if (m.kind !== "tool" || m.toolCallId !== callId) return m;
          const isError = Boolean(e.isError);
          return {
            ...m,
            status: isError ? ("error" as const) : ("ok" as const),
            output: m.output ?? extractToolOutput(result, isError),
          };
        }),
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
      messages: items.map((m): UIMessage => {
        if (m.role === "tool") {
          return {
            id: nextId(),
            kind: "tool",
            toolCallId: m.toolCallId ?? nextId(),
            toolName: m.toolName ?? "tool",
            status: m.isError ? "error" : "ok",
            input: m.toolInput,
            output: m.text || undefined,
          };
        }
        return {
          id: nextId(),
          kind: m.role === "user" ? "user" : m.role === "assistant" ? "assistant" : "system",
          text: m.text,
        };
      }),
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
