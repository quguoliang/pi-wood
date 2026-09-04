import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { RuntimeInfo } from "@pi-wood/ipc-schema";
import { activeSlice, useActiveConversation, useSessionStore } from "../stores/session-store";
import { useBtwStore, buildContextBlock } from "../stores/btw-store";
import { useGoalStore } from "../stores/goal-store";
import { useWorkbenchStore } from "../stores/workbench-store";
import { countLines } from "../lib/utils";
import { readDraft, writeDraft, clearDraft } from "../lib/chat-draft-persistence";
import type { ApprovalMode } from "../components/center/ComposerControls";

export interface AttachmentItem {
  path: string;
  name: string;
  size: number;
  kind: "file" | "image";
}

interface ApprovalRule {
  pattern: string;
  action: "allow" | "ask" | "deny";
}

/**
 * Composer 的全部状态与动作（逻辑层，组件只负责呈现）。
 * 空态居中对话框与对话态底部对话框共用同一控制器。
 *
 * 数据源：runtime 走 `runtimeInfo()`（含 model/thinkingLevel/contextUsage/git），
 * 一次拉齐头部项目/git 芯片与底部模型/思考/上下文控件所需字段。
 */
export function useComposerController() {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [models, setModels] = useState<Array<{ provider: string; id: string }>>([]);
  const [thinkingLevels, setThinkingLevels] = useState<string[]>([]);
  const [runtime, setRuntime] = useState<RuntimeInfo | undefined>(undefined);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("highRisk");
  const [approvalRules, setApprovalRules] = useState<ApprovalRule[]>([]);
  const [sending, setSending] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // T7.11：草稿持久化——实时镜像当前输入/附件供切换时同步落盘，追踪上次会话 id、防抖计时器
  const liveRef = useRef<{ input: string; attachments: AttachmentItem[] }>({ input: "", attachments: [] });
  const prevSessionRef = useRef<string | undefined>(undefined);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const streaming = useActiveConversation((c) => c.streaming);
  const engineReady = useActiveConversation((c) => c.engineReady);
  const activeProject = useSessionStore((s) => s.activeProject);
  const items = useActiveConversation((c) => c.items);
  const liveText = useActiveConversation((c) => c.liveText);
  const currentSessionId = useActiveConversation((c) => c.currentSessionId);
  const hasConversation = items.length > 0 || Boolean(liveText) || streaming;

  const refreshRuntime = useCallback(async (): Promise<void> => {
    if (!engineReady) {
      setRuntime(undefined);
      setModels([]);
      setThinkingLevels([]);
      return;
    }
    const [info, nextModels, nextLevels] = await Promise.all([
      window.pi.runtimeInfo().catch(() => undefined),
      window.pi.engineModels().catch(() => []),
      window.pi.engineThinkingLevels().catch(() => []),
    ]);
    setRuntime(info);
    setModels(nextModels);
    setThinkingLevels(nextLevels);
  }, [engineReady]);

  useEffect(() => {
    void window.pi.settingsGet().then((settings) => {
      const approval = (settings as { approval?: { mode?: ApprovalMode; rules?: ApprovalRule[] } }).approval;
      if (approval?.mode) setApprovalMode(approval.mode);
      setApprovalRules(approval?.rules ?? []);
    });
  }, []);

  useEffect(() => {
    void refreshRuntime().catch((err) => setError(String((err as Error)?.message ?? err)));
  }, [refreshRuntime, activeProject, streaming]);

  // 自适应高度
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(200, Math.max(36, textarea.scrollHeight))}px`;
  }, [input]);

  // T5.1：命令面板向输入框注入文本（slash/skill 命令 replace、@文件 追加）
  useEffect(() => {
    const onInsert = (e: Event): void => {
      const { text, replace } = ((e as CustomEvent).detail ?? {}) as { text?: string; replace?: boolean };
      if (!text) return;
      setInput((prev) => {
        if (replace) return text;
        const base = prev.trimEnd();
        return base ? `${base} ${text}` : text;
      });
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      });
    };
    window.addEventListener("piwood:composer-insert", onInsert);
    return () => window.removeEventListener("piwood:composer-insert", onInsert);
  }, []);

  // T7.11：实时镜像当前输入/附件，供切换会话时同步落盘（避免 debounce 竞态丢最后输入）
  useEffect(() => {
    liveRef.current = { input, attachments };
  }, [input, attachments]);

  // T7.11：输入/附件变更防抖 500ms 写入当前会话草稿
  useEffect(() => {
    if (!currentSessionId) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      writeDraft(currentSessionId, { text: input, attachments });
    }, 500);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [input, attachments, currentSessionId]);

  // T7.11：切换会话——先把上一会话最新输入落盘，再载入新会话草稿（无草稿则真实切换时清空）
  useEffect(() => {
    const prev = prevSessionRef.current;
    prevSessionRef.current = currentSessionId;
    if (prev && prev !== currentSessionId) {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      writeDraft(prev, { text: liveRef.current.input, attachments: liveRef.current.attachments });
    }
    if (!currentSessionId) return;
    const draft = readDraft(currentSessionId);
    if (draft) {
      setInput(draft.text);
      setAttachments(draft.attachments);
    } else if (prev && prev !== currentSessionId) {
      // 真实切换到无草稿的会话：清空输入，不把上一会话文本带过去
      setInput("");
      setAttachments([]);
    }
    // prev 未定义（引擎会话首次实体化）→ 不动输入，保留 onboarding 已敲内容
  }, [currentSessionId]);

  const send = useCallback(
    async (mode: "prompt" | "followUp" = "prompt"): Promise<void> => {
      const text = input.trim();
      if (!text || !engineReady) return;

      // T7.6：/btw 前缀 → 走侧边问答的独立第二会话，绝不进主会话（主会话流式进行中也可用）
      if (mode === "prompt" && /^\/btw(\s|$)/.test(text)) {
        const question = text.replace(/^\/btw\s*/, "").trim();
        if (!question) {
          setError("请输入侧边问题，例如 /btw 这个函数是做什么的？");
          return;
        }
        setError("");
        setInput("");
        const parentId = activeSlice().currentSessionId;
        useWorkbenchStore.getState().openTab("btw");
        void useBtwStore.getState().ask(parentId ?? "", question, buildContextBlock(items));
        return;
      }

      if (streaming && mode === "prompt") return;
      if (streaming && attachments.length > 0) {
        setError("生成过程中排队的消息暂不支持附件，请等待当前回复结束。");
        return;
      }
      // T7.5：「作为目标发送」开启 → 本次输入成为目标并 kickoff（goal-runtime 后续据审计自动续跑）
      if (mode === "prompt" && useGoalStore.getState().arm) {
        setInput("");
        setError("");
        void useGoalStore.getState().set(currentSessionId ?? "", text);
        return;
      }
      setInput("");
      setAttachments([]);
      setError("");
      setSending(true);
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      try {
        if (mode === "followUp") await window.pi.engineFollowUp(text);
        else {
          useSessionStore.getState().addUserMessage(text);
          await window.pi.prompt(text, attachments.map((item) => item.path));
        }
        // T7.11：已发出 → 清除该会话草稿（liveRef 也已随 setInput("") 归零，防抖不再复活）
        clearDraft(currentSessionId ?? "");
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
      } finally {
        setSending(false);
        void refreshRuntime();
      }
    },
    [input, engineReady, streaming, attachments, items, currentSessionId, refreshRuntime],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      if (event.altKey && streaming) void send("followUp");
      else if (!streaming) void send("prompt");
    },
    [send, streaming],
  );

  const pickFiles = useCallback(async (): Promise<void> => {
    const selected = await window.pi.projectPickAttachments();
    setAttachments((current) => {
      const merged = [...current];
      for (const item of selected) if (!merged.some((existing) => existing.path === item.path)) merged.push(item);
      return merged.slice(0, 12);
    });
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const removeAttachment = useCallback((path: string): void => {
    setAttachments((current) => current.filter((entry) => entry.path !== path));
  }, []);

  // T7.1：大文本粘贴 → 落盘为临时文件并加入附件（不进入输入框）。
  const addPastedText = useCallback(async (text: string): Promise<void> => {
    try {
      const staged = await window.pi.stagePastedText(text);
      setAttachments((current) => {
        const merged = [...current];
        if (!merged.some((entry) => entry.path === staged.path)) merged.push(staged);
        return merged.slice(0, 12);
      });
      toast(`已作为文件附件添加（${text.length} 字符 / ${countLines(text)} 行）`);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
  }, []);

  const changeApproval = useCallback(
    async (mode: ApprovalMode): Promise<void> => {
      const previous = approvalMode;
      setError("");
      try {
        await window.pi.settingsSet({ approval: { mode, rules: approvalRules } });
        setApprovalMode(mode);
      } catch (err) {
        setApprovalMode(previous);
        setError(String((err as Error)?.message ?? err));
      }
    },
    [approvalMode, approvalRules],
  );

  const changeModel = useCallback(
    async (model: { provider: string; id: string }): Promise<void> => {
      setError("");
      try {
        await window.pi.engineSetModel(model.provider, model.id);
        await refreshRuntime();
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
      }
    },
    [refreshRuntime],
  );

  const changeThinking = useCallback(
    async (level: string): Promise<void> => {
      setError("");
      try {
        await window.pi.engineSetThinking(level);
        await refreshRuntime();
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
      }
    },
    [refreshRuntime],
  );

  const compact = useCallback((): void => {
    void window.pi
      .engineCompact()
      .then(refreshRuntime)
      .catch((err) => setError(String(err)));
  }, [refreshRuntime]);

  const abort = useCallback(async (): Promise<void> => {
    setAborting(true);
    try {
      await window.pi.engineAbort();
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setAborting(false);
    }
  }, []);

  return {
    input,
    setInput,
    attachments,
    removeAttachment,
    models,
    thinkingLevels,
    runtime,
    approvalMode,
    sending,
    aborting,
    error,
    canSend: engineReady && !sending && Boolean(input.trim()),
    engineReady,
    activeProject,
    streaming,
    hasConversation,
    textareaRef,
    send,
    onKeyDown,
    pickFiles,
    addPastedText,
    changeApproval,
    changeModel,
    changeThinking,
    compact,
    abort,
  };
}

export type ComposerController = ReturnType<typeof useComposerController>;
