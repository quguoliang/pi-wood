import { useCallback, useEffect, useRef, useState } from "react";
import type { RuntimeInfo } from "@pi-wood/ipc-schema";
import { useSessionStore } from "../stores/session-store";
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

  const streaming = useSessionStore((s) => s.streaming);
  const engineReady = useSessionStore((s) => s.engineReady);
  const activeProject = useSessionStore((s) => s.activeProject);
  const items = useSessionStore((s) => s.items);
  const liveText = useSessionStore((s) => s.liveText);
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

  const send = useCallback(
    async (mode: "prompt" | "followUp" = "prompt"): Promise<void> => {
      const text = input.trim();
      if (!text || !engineReady) return;
      if (streaming && mode === "prompt") return;
      if (streaming && attachments.length > 0) {
        setError("生成过程中排队的消息暂不支持附件，请等待当前回复结束。");
        return;
      }
      setInput("");
      setAttachments([]);
      setError("");
      setSending(true);
      try {
        if (mode === "followUp") await window.pi.engineFollowUp(text);
        else {
          useSessionStore.getState().addUserMessage(text);
          await window.pi.prompt(text, attachments.map((item) => item.path));
        }
      } catch (err) {
        setError(String((err as Error)?.message ?? err));
      } finally {
        setSending(false);
        void refreshRuntime();
      }
    },
    [input, engineReady, streaming, attachments, refreshRuntime],
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
    changeApproval,
    changeModel,
    changeThinking,
    compact,
    abort,
  };
}

export type ComposerController = ReturnType<typeof useComposerController>;
