import { create } from "zustand";

/**
 * T7.6 侧边问答 store：按「父会话 id」保存各自的临时问答转录本，事件来自主进程隔离的第二
 * 运行时（engine:btwEvent 通道，只含侧边会话事件）。切换/切回父会话时面板读到对应转录本。
 */
export interface BtwTranscript {
  question: string;
  thinking: string;
  text: string;
  streaming: boolean;
  aborted?: boolean;
  error?: string;
}

interface BtwState {
  bySession: Record<string, BtwTranscript>;
  /** 当前侧边运行归属的父会话 key（事件都归到它）。 */
  activeKey: string | null;
  ask(parentKey: string, question: string, context: string): Promise<void>;
  handleEvent(e: Record<string, unknown>): void;
  abort(): Promise<void>;
  dispose(): Promise<void>;
}

const keyFor = (parentId: string | undefined): string => parentId || "__none__";

export const useBtwStore = create<BtwState>((set, get) => ({
  bySession: {},
  activeKey: null,

  async ask(parentKey, question, context) {
    const k = keyFor(parentKey);
    set((s) => ({
      activeKey: k,
      bySession: { ...s.bySession, [k]: { question, thinking: "", text: "", streaming: true } },
    }));
    try {
      await window.pi.btwAsk(question, context);
      // prompt 在回合结束时 resolve；兜底清 streaming（事件通常已置）
      const cur = get().bySession[k];
      if (cur?.streaming) set((s) => ({ bySession: { ...s.bySession, [k]: { ...cur, streaming: false } } }));
    } catch (err) {
      const cur = get().bySession[k];
      if (cur) set((s) => ({ bySession: { ...s.bySession, [k]: { ...cur, streaming: false, error: String((err as Error)?.message ?? err) } } }));
    }
  },

  handleEvent(e) {
    const k = get().activeKey;
    if (!k) return;
    const cur = get().bySession[k];
    if (!cur) return;
    const type = e.type as string;
    const patch = (over: Partial<BtwTranscript>): void =>
      set((s) => (s.bySession[k] ? { bySession: { ...s.bySession, [k]: { ...s.bySession[k], ...over } } } : s));

    switch (type) {
      case "message_update": {
        const a = e.assistantMessageEvent as { type?: string; delta?: unknown; thinking?: unknown; text?: unknown } | undefined;
        if (!a) return;
        const piece = typeof a.delta === "string" ? a.delta : typeof a.thinking === "string" ? a.thinking : typeof a.text === "string" ? a.text : "";
        if (a.type === "text_delta") patch({ text: cur.text + piece });
        else if (a.type === "thinking_delta") patch({ thinking: cur.thinking + piece });
        return;
      }
      case "agent_end":
      case "agent_settled":
        patch({ streaming: false });
        return;
      case "turn_end": {
        const stopReason = (e.message as { stopReason?: string } | undefined)?.stopReason;
        patch(stopReason === "aborted" ? { streaming: false, aborted: true } : { streaming: false });
        return;
      }
      default:
        return;
    }
  },

  async abort() {
    try {
      await window.pi.btwAbort();
    } catch {
      /* 忽略 */
    }
  },

  async dispose() {
    try {
      await window.pi.btwClose();
    } catch {
      /* 忽略 */
    }
    set({ activeKey: null });
  },
}));

/** 从主会话 ConversationItem[] 裁出最近若干轮纯文本上下文（仅 user/assistant，工具压成一行）。 */
export function buildContextBlock(
  items: Array<{ kind: string; text?: string; name?: string }>,
  maxTurns = 12,
  maxChars = 4000,
): string {
  const recent = items.slice(-maxTurns);
  const lines: string[] = [];
  let total = 0;
  for (const it of recent) {
    let line = "";
    if (it.kind === "user") line = `用户：${(it.text ?? "").replace(/\s+/g, " ").trim()}`;
    else if (it.kind === "assistant") line = `助手：${(it.text ?? "").replace(/\s+/g, " ").trim()}`;
    else if (it.kind === "tool") line = `[工具 ${it.name ?? ""}]`;
    else continue;
    if (!line) continue;
    total += line.length + 1;
    if (total > maxChars) {
      lines.push("…（更早上下文已省略）");
      break;
    }
    lines.push(line);
  }
  return lines.join("\n");
}
