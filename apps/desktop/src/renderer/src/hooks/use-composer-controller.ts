import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { RuntimeInfo } from "@pi-wood/ipc-schema";
import { activeSlice, useActiveConversation, useSessionStore } from "../stores/session-store";
import { useBtwStore, buildContextBlock } from "../stores/btw-store";
import { useGoalStore } from "../stores/goal-store";
import { useWorkbenchStore } from "../stores/workbench-store";
import { countLines } from "../lib/utils";
import { readDraft, writeDraft, clearDraft } from "../lib/chat-draft-persistence";
import { useSettingsStore, type ConversationApprovalMode } from "../stores/settings-store";
import { useConversationsStore } from "../stores/conversations-store";
import { usePendingContextStore, type PendingSnippet } from "../stores/pending-context-store";

export interface AttachmentItem {
  path: string;
  name: string;
  size: number;
  kind: "file" | "image";
}

/** 「添加到对话」片段 → 消息尾部引用块（path:起-止 头 + 代码块），agent 侧零协议改动 */
function appendSnippetQuotes(text: string, snippets: PendingSnippet[]): string {
  if (snippets.length === 0) return text;
  const blocks = snippets
    .map((s) => `${s.path}:${s.start}-${s.end}\n\`\`\`\n${s.snippet}\n\`\`\``)
    .join("\n\n");
  return `${text}\n\n---\n引用片段：\n\n${blocks}`;
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
  /** 供应商 id → 显示名（内置 + 自定义都覆盖），模型下拉按供应商分组时的组标题用 */
  const [providerNames, setProviderNames] = useState<Record<string, string>>({});
  const [thinkingLevels, setThinkingLevels] = useState<string[]>([]);
  const [runtime, setRuntime] = useState<RuntimeInfo | undefined>(undefined);
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
  // 「Agent 权限」档（原 T7.2 自动接受与全局 approval.mode 合并后的唯一入口）：
  // per-对话档 approvalByConversation[conversationId] 优先，未配置回退全局 approval.mode。
  const conversationId = useSessionStore((s) => s.activeConversationId);
  const draftProject = useSessionStore((s) => s.draftProject);
  // 草稿态：点「+」进入，active=null 且 draftProject 有值。此时不建对话、不 fork 引擎，
  // 只允许输入文本；首次发送才物化（见 send）。引擎相关配置控件（模型/思考/上下文/审批）
  // 依赖活跃引擎，草稿态下禁用——发送后随对话实体化自动启用。
  const drafting = conversationId === null && Boolean(draftProject);
  const canCompose = engineReady || drafting;
  const approvalByConv = useSettingsStore((s) => s.settings.approvalByConversation);
  const globalMode = useSettingsStore(
    (s) => (s.settings as { approval?: { mode?: ConversationApprovalMode } }).approval?.mode,
  );
  const approvalMode: ConversationApprovalMode =
    (conversationId ? approvalByConv[conversationId] : undefined) ?? globalMode ?? "highRisk";

  const refreshRuntime = useCallback(async (): Promise<void> => {
    if (!engineReady) {
      // 切换对话的 1~2s（selectSession 置 engineReady=false，防止 prompt 打进旧会话）期间**不清场**：
      // 这里一清，模型/思考/上下文控件就从真值闪回「选择模型／思考」占位，等引擎就绪再弹回——
      // 正是「切对话底部闪动」的主因。这些值是引擎/项目级的，不是对话级的，跨对话短暂保留语义成立。
      // 只有「真正没有活跃对话」（项目切换 activateProject 置 null／全部关闭回空态）才清——
      // 那两条路径本来就是整屏换底，清掉才是正确语义。
      if (useSessionStore.getState().activeConversationId === null) {
        setRuntime(undefined);
        setModels([]);
        setThinkingLevels([]);
      }
      return;
    }
    const [info, nextModels, nextLevels, providers] = await Promise.all([
      window.pi.runtimeInfo().catch(() => undefined),
      window.pi.engineModels().catch(() => []),
      window.pi.engineThinkingLevels().catch(() => []),
      window.pi.providerList().catch(() => undefined),
    ]);
    setRuntime(info);
    setModels(nextModels);
    setThinkingLevels(nextLevels);
    const p = providers as
      | { builtin?: Array<{ id: string; name: string }>; custom?: Array<{ id: string; name: string }> }
      | undefined;
    setProviderNames(
      Object.fromEntries([...(p?.builtin ?? []), ...(p?.custom ?? [])].map((item) => [item.id, item.name])),
    );
  }, [engineReady]);

  // 供应商增删改（models.json 已刷新）→ 重取模型列表与供应商显示名，下拉即时看到新供应商/模型
  useEffect(() => {
    const off = window.pi.onProviderChanged(() => void refreshRuntime());
    return off;
  }, [refreshRuntime]);

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

  // 「+ 新任务」进入草稿态后聚焦输入框（startDraft 派发此事件）
  useEffect(() => {
    const onFocus = (): void => {
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    window.addEventListener("piwood:composer-focus", onFocus);
    return () => window.removeEventListener("piwood:composer-focus", onFocus);
  }, []);

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
      const raw = input.trim();
      if (!raw || !canCompose) return;
      // 「添加到对话」片段：发送时展开为带 path:起-止 头的代码块拼进消息（agent 零协议改动）
      const snippets = usePendingContextStore.getState().items;
      const text = appendSnippetQuotes(raw, snippets);

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
        usePendingContextStore.getState().clear();
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
        usePendingContextStore.getState().clear();
        return;
      }
      setInput("");
      setAttachments([]);
      setError("");
      setSending(true);
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      try {
        // 草稿态首次发送：先物化对话（createConversation 建引擎 + 注册 + 设为活跃），再落这条消息。
        // 「+」不提前建任务，正是靠这一步把「正式创建」推迟到发送这一刻。
        if (drafting) {
          await useConversationsStore.getState().createConversation(draftProject ?? undefined);
        }
        if (mode === "followUp") await window.pi.engineFollowUp(text);
        else {
          useSessionStore.getState().addUserMessage(text);
          await window.pi.prompt(text, attachments.map((item) => item.path));
        }
        // T7.11：已发出 → 清除该会话草稿（liveRef 也已随 setInput("") 归零，防抖不再复活）
        clearDraft(currentSessionId ?? "");
        usePendingContextStore.getState().clear();
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
      } finally {
        setSending(false);
        void refreshRuntime();
      }
    },
    [input, canCompose, drafting, draftProject, streaming, attachments, items, currentSessionId, refreshRuntime],
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
    async (mode: ConversationApprovalMode): Promise<void> => {
      if (!conversationId) {
        setError("对话尚未就绪，稍后再调整权限档");
        return;
      }
      setError("");
      try {
        await useSettingsStore.getState().patch({ approvalByConversation: { [conversationId]: mode } });
        // 切到「完全访问」→ 顺手放行该对话在飞的审批/确认卡（与原「自动接受」开关同义）
        if (mode === "auto") await window.pi.approvalAcceptAll().catch(() => undefined);
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
      }
    },
    [conversationId],
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
    providerNames,
    thinkingLevels,
    runtime,
    approvalMode,
    sending,
    aborting,
    error,
    canSend: canCompose && !sending && Boolean(input.trim()),
    engineReady,
    canCompose,
    drafting,
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
