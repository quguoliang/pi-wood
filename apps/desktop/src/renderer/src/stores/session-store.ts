import { create } from "zustand";

/**
 * 会话 store（UI v3 重写，严格对齐 Pi SDK v0.84.4 真实事件字段）。
 *
 * 数据流要点（见执行计划 §8 调研）：
 * - assistant 流式：message_update.assistantMessageEvent 的 text_delta/thinking_delta
 *   写入独立 live buffer（避免每 token 对长列表做 O(n) 拷贝），块 *_end 或工具启动/
 *   回合结束时 flush 成 finalized item。
 * - 工具：tool_execution_start.args（非 input）、tool_execution_update.partialResult
 *   （非 output）、tool_execution_end.result.{content,details}。edit 的 result.details
 *   含结构化 patch/diff，直接内联渲染。
 * - 回合/状态：agent_start/end/settled、compaction_*、auto_retry_*、queue_update。
 */

export type ToolStatus = "running" | "ok" | "error";

export interface DiffStat {
  added: number;
  deleted: number;
}

export type ConversationItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "thinking"; text: string; durationMs?: number }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      name: string;
      args: Record<string, unknown>;
      status: ToolStatus;
      output?: string;
      diff?: string;
      diffStat?: DiffStat;
      truncated?: boolean;
      fullOutputPath?: string;
      /** T5.6：工具开始时刻（epoch ms），用于分组总耗时聚合。 */
      startedAt?: number;
      /** T5.6：工具耗时（ms），tool_execution_end 时由 startedAt 推算。 */
      durationMs?: number;
    }
  | {
      id: string;
      kind: "system";
      text: string;
      tone: "info" | "warn" | "error" | "success";
      align?: "center" | "start";
    };

export interface HistoryMessageItem {
  role: string;
  text: string;
  toolCallId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  isError?: boolean;
}

interface LiveState {
  liveText: string;
  liveThinking: string;
}

interface SessionState extends LiveState {
  items: ConversationItem[];
  streaming: boolean;
  activeProject: string | undefined;
  engineReady: boolean;
  /** T7.2：当前引擎会话 id（供 per-session 自动接受按会话取状态）。 */
  currentSessionId: string | undefined;
  /**
   * T8.2：渲染层认定的「用户正在看」的对话 id。唯一写入口是 noteEventOwnership
   * （主进程在 envelope 上打 active===true 的权威信号）；slice-per-conversation 落地在 T8.3。
   */
  activeConversationId: string | null;
  /** T8.2：被判给其它对话、未进当前转录本的事件计数——丢事件不许静默，计数必须可见。 */
  foreignEventCount: number;
  queue: { steering: string[]; followUp: string[] };
  handleEvent(e: Record<string, unknown>): void;
  /** T8.2：从 preload 归一化的 meta 记录对话归属。纯状态更新，不做路由判定（路由在调用方）。 */
  noteEventOwnership(meta: { conversationId: string | null; active?: boolean; legacy: boolean }): void;
  addUserMessage(text: string): void;
  loadMessages(items: HistoryMessageItem[]): void;
  reset(): void;
  setActiveProject(projectDir: string | undefined): void;
  setEngineReady(ready: boolean): void;
  refreshSessionId(): Promise<void>;
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

/** 把工具结果/部分内容（content 数组块或字符串）解成可读文本。 */
const extractText = (result: unknown): string | undefined => {
  if (result === undefined || result === null) return undefined;
  if (typeof result === "string") return result;
  const content = (result as { content?: unknown }).content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : part && typeof part === "object" && (part as { type?: unknown }).type === "image"
            ? "[图片]"
            : "",
      )
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }
  if (typeof (result as { text?: unknown }).text === "string") return (result as { text: string }).text;
  if (typeof (result as { message?: unknown }).message === "string") return (result as { message: string }).message;
  return safeStringify(result);
};

/** 从 unified patch 统计 +/- 行数（排除 +++/--- 文件头）。 */
const statPatch = (patch: string): DiffStat => {
  let added = 0;
  let deleted = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) deleted += 1;
  }
  return { added, deleted };
};

const asArgs = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : v === undefined
      ? {}
      : { value: v };

let thinkingStartedAt = 0;

export const useSessionStore = create<SessionState>((set, get) => {
  /** 把当前 live thinking/text flush 成 finalized items（保证与后续工具的顺序）。 */
  const flushLive = (): void => {
    const { liveText, liveThinking, items } = get();
    const additions: ConversationItem[] = [];
    if (liveThinking.trim()) {
      additions.push({
        id: nextId(),
        kind: "thinking",
        text: liveThinking,
        durationMs: thinkingStartedAt ? Date.now() - thinkingStartedAt : undefined,
      });
      thinkingStartedAt = 0;
    }
    if (liveText.trim()) additions.push({ id: nextId(), kind: "assistant", text: liveText });
    if (additions.length) set({ items: [...items, ...additions], liveText: "", liveThinking: "" });
    else if (liveText || liveThinking) set({ liveText: "", liveThinking: "" });
  };

  const pushItem = (item: ConversationItem): void => set({ items: [...get().items, item] });

  const updateTool = (toolCallId: string, patch: Partial<Extract<ConversationItem, { kind: "tool" }>>): void => {
    set({
      items: get().items.map((m) => (m.kind === "tool" && m.toolCallId === toolCallId ? { ...m, ...patch } : m)),
    });
  };

  return {
    items: [],
    liveText: "",
    liveThinking: "",
    streaming: false,
    activeProject: undefined,
    engineReady: false,
    currentSessionId: undefined,
    activeConversationId: null,
    foreignEventCount: 0,
    queue: { steering: [], followUp: [] },

    handleEvent(e) {
      const type = e.type as string;
      switch (type) {
        case "user_message":
          get().addUserMessage(String(e.text ?? ""));
          return;
        case "agent_start":
          set({ streaming: true });
          return;
        case "agent_end":
        case "agent_settled":
          flushLive();
          set({ streaming: false, queue: { steering: [], followUp: [] } });
          return;
        case "message_end":
          flushLive();
          return;
        case "message_update": {
          const a = e.assistantMessageEvent as { type?: string; delta?: unknown } | undefined;
          if (!a) return;
          switch (a.type) {
            case "thinking_start":
              thinkingStartedAt = Date.now();
              set({ liveThinking: "" });
              return;
            case "thinking_delta":
              set({ liveThinking: get().liveThinking + (typeof a.delta === "string" ? a.delta : "") });
              return;
            case "thinking_end":
              flushLive();
              return;
            case "text_start":
              set({ liveText: "" });
              return;
            case "text_delta":
              set({ liveText: get().liveText + (typeof a.delta === "string" ? a.delta : "") });
              return;
            case "text_end":
              flushLive();
              return;
            default:
              return;
          }
        }
        case "tool_execution_start": {
          flushLive();
          pushItem({
            id: nextId(),
            kind: "tool",
            toolCallId: String(e.toolCallId ?? `t${Date.now()}`),
            name: String(e.toolName ?? "tool"),
            args: asArgs(e.args),
            status: "running",
            startedAt: Date.now(),
          });
          return;
        }
        case "tool_execution_update": {
          const text = extractText(e.partialResult);
          if (text !== undefined) updateTool(String(e.toolCallId ?? ""), { output: text });
          return;
        }
        case "tool_execution_end": {
          const callId = String(e.toolCallId ?? "");
          const result = e.result as
            | { content?: unknown; details?: { patch?: string; diff?: string; truncation?: unknown; fullOutputPath?: string } }
            | undefined;
          const details = result?.details;
          const patch = details?.patch || details?.diff;
          const patchUpdate: Partial<Extract<ConversationItem, { kind: "tool" }>> = {
            status: e.isError ? "error" : "ok",
          };
          const running = get().items.find(
            (m): m is Extract<ConversationItem, { kind: "tool" }> => m.kind === "tool" && m.toolCallId === callId,
          );
          const started = running?.startedAt;
          if (started != null) patchUpdate.durationMs = Date.now() - started;
          const out = extractText(result);
          if (out !== undefined) patchUpdate.output = out;
          if (patch) {
            patchUpdate.diff = patch;
            patchUpdate.diffStat = statPatch(patch);
          }
          if (details?.fullOutputPath) patchUpdate.fullOutputPath = details.fullOutputPath;
          if (details?.truncation) patchUpdate.truncated = true;
          updateTool(callId, patchUpdate);
          return;
        }
        case "turn_end": {
          flushLive();
          // Pi agent-loop：用户中断时 turn 的最后一条 assistant message.stopReason === "aborted"
          const stopReason = (e.message as { stopReason?: string } | undefined)?.stopReason;
          if (stopReason === "aborted") {
            pushItem({ id: nextId(), kind: "system", tone: "warn", align: "start", text: "对话已终止" });
          }
          return;
        }
        case "compaction_start":
          flushLive();
          pushItem({ id: nextId(), kind: "system", tone: "info", text: "正在压缩上下文…" });
          return;
        case "compaction_end":
          pushItem({
            id: nextId(),
            kind: "system",
            tone: e.aborted ? "warn" : "info",
            text: e.aborted ? "上下文压缩已中止" : "上下文已压缩",
          });
          return;
        case "auto_retry_start":
          pushItem({
            id: nextId(),
            kind: "system",
            tone: "warn",
            text: `请求失败，自动重试（第 ${e.attempt ?? "?"}/${e.maxAttempts ?? "?"} 次）…`,
          });
          return;
        case "auto_retry_end":
          pushItem({
            id: nextId(),
            kind: "system",
            tone: e.success ? "success" : "error",
            text: e.success ? "重试成功" : `重试失败${e.finalError ? `：${String(e.finalError)}` : ""}`,
          });
          return;
        case "queue_update":
          set({
            queue: {
              steering: Array.isArray(e.steering) ? (e.steering as string[]) : [],
              followUp: Array.isArray(e.followUp) ? (e.followUp as string[]) : [],
            },
          });
          return;
        default:
          return;
      }
    },

    noteEventOwnership(meta) {
      // active===true 是主进程推送时盖的「用户正看着这条对话」权威信号：与已存 id 不同就采纳。
      // legacy 裸事件无归属信息：维持 null 行为（不采纳也不清空），与 T8.2 之前逐位一致。
      if (meta.active === true && meta.conversationId && meta.conversationId !== get().activeConversationId) {
        set({ activeConversationId: meta.conversationId });
      }
    },

    addUserMessage(text) {
      flushLive();
      pushItem({ id: nextId(), kind: "user", text });
      set({ liveText: "", liveThinking: "" });
    },

    loadMessages(list) {
      set({
        items: list.map((m): ConversationItem => {
          if (m.role === "tool") {
            return {
              id: nextId(),
              kind: "tool",
              toolCallId: m.toolCallId ?? nextId(),
              name: m.toolName ?? "tool",
              args: m.toolInput ?? {},
              status: m.isError ? "error" : "ok",
              output: m.text || undefined,
            };
          }
          if (m.role === "user") return { id: nextId(), kind: "user", text: m.text };
          if (m.role === "assistant") return { id: nextId(), kind: "assistant", text: m.text };
          return { id: nextId(), kind: "system", tone: "info", text: m.text };
        }),
        liveText: "",
        liveThinking: "",
        streaming: false,
      });
    },

    reset() {
      set({ items: [], liveText: "", liveThinking: "", streaming: false, currentSessionId: undefined, queue: { steering: [], followUp: [] } });
    },

    setActiveProject(projectDir) {
      set({ activeProject: projectDir, currentSessionId: undefined });
    },

    setEngineReady(ready) {
      set({ engineReady: ready });
    },

    async refreshSessionId() {
      const state = await window.pi.engineState().catch(() => undefined);
      set({ currentSessionId: state?.sessionId });
    },
  };
});
