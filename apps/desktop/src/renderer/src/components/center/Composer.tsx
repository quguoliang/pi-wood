import { useCallback, useEffect, useRef, useState } from "react";
import { PromptSuggestion } from "@pi-wood/ui-kit";
import { useSessionStore } from "../../stores/session-store";
import { ComposerControls, type ApprovalMode, type RuntimeState } from "./ComposerControls";
import { Icon } from "../ui/Icon";

interface AttachmentItem {
  path: string;
  name: string;
  size: number;
  kind: "file" | "image";
}

const quickPrompts = [
  "检查这个项目当前的状态和主要问题",
  "运行现有测试并修复失败项",
  "审查当前未提交的代码变更",
  "解释这个项目的结构和核心流程",
];

export function Composer(): React.JSX.Element {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [models, setModels] = useState<Array<{ provider: string; id: string }>>([]);
  const [thinkingLevels, setThinkingLevels] = useState<string[]>([]);
  const [runtime, setRuntime] = useState<RuntimeState>({});
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("highRisk");
  const [approvalRules, setApprovalRules] = useState<Array<{ pattern: string; action: "allow" | "ask" | "deny" }>>([]);
  const [sending, setSending] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streaming = useSessionStore((s) => s.streaming);
  const engineReady = useSessionStore((s) => s.engineReady);
  const activeProject = useSessionStore((s) => s.activeProject);
  const messages = useSessionStore((s) => s.messages);
  const streamBuffer = useSessionStore((s) => s.streamBuffer);
  const empty = messages.length === 0 && !streamBuffer && !streaming;
  const projectName = activeProject?.split(/[\\/]/).filter(Boolean).pop() ?? "未选择项目";

  const refreshRuntime = useCallback(async (): Promise<void> => {
    if (!engineReady) {
      setRuntime({});
      setModels([]);
      setThinkingLevels([]);
      return;
    }
    const [nextRuntime, nextModels, nextLevels] = await Promise.all([
      window.pi.engineState(),
      window.pi.engineModels(),
      window.pi.engineThinkingLevels(),
    ]);
    setRuntime(nextRuntime);
    setModels(nextModels);
    setThinkingLevels(nextLevels);
  }, [engineReady]);

  useEffect(() => {
    void window.pi.settingsGet().then((settings) => {
      const approval = (settings as { approval?: { mode?: ApprovalMode; rules?: Array<{ pattern: string; action: "allow" | "ask" | "deny" }> } }).approval;
      const mode = approval?.mode;
      if (mode) setApprovalMode(mode);
      setApprovalRules(approval?.rules ?? []);
    });
  }, []);

  useEffect(() => {
    void refreshRuntime().catch((err) => setError(String((err as Error)?.message ?? err)));
  }, [refreshRuntime, activeProject, streaming]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(176, Math.max(64, textarea.scrollHeight))}px`;
  }, [input]);

  const send = async (mode: "prompt" | "followUp" = "prompt"): Promise<void> => {
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
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (event.altKey && streaming) void send("followUp");
    else if (!streaming) void send("prompt");
  };

  const pickFiles = async (): Promise<void> => {
    const selected = await window.pi.projectPickAttachments();
    setAttachments((current) => {
      const merged = [...current];
      for (const item of selected) if (!merged.some((existing) => existing.path === item.path)) merged.push(item);
      return merged.slice(0, 12);
    });
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const changeApproval = async (mode: ApprovalMode): Promise<void> => {
    const previous = approvalMode;
    setError("");
    try {
      await window.pi.settingsSet({ approval: { mode, rules: approvalRules } });
      setApprovalMode(mode);
    } catch (err) {
      setApprovalMode(previous);
      setError(String((err as Error)?.message ?? err));
    }
  };

  const changeModel = async (model: { provider: string; id: string }): Promise<void> => {
    setError("");
    try {
      await window.pi.engineSetModel(model.provider, model.id);
      await refreshRuntime();
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
  };

  const changeThinking = async (level: string): Promise<void> => {
    setError("");
    try {
      await window.pi.engineSetThinking(level);
      await refreshRuntime();
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
  };

  const abort = async (): Promise<void> => {
    setAborting(true);
    try {
      await window.pi.engineAbort();
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setAborting(false);
    }
  };

  return (
    <section className={`composer-wrap${empty ? " empty-composer" : ""}`} aria-label="发送消息">
      <div className="composer-shell">
        {engineReady && (
          <div className="composer-project" title={activeProject}>
            <Icon name="folder" /><span>{projectName}</span><i className="engine-ready-dot" />
          </div>
        )}
        <div className="composer" data-streaming={streaming || undefined}>
          {attachments.length > 0 && (
            <div className="attachment-strip" aria-label="已添加的文件">
              {attachments.map((item) => (
                <span className="attachment-chip" key={item.path} title={item.path}>
                  <Icon name={item.kind === "image" ? "image" : "file"} />
                  <span>{item.name}</span>
                  <button type="button" onClick={() => setAttachments((current) => current.filter((entry) => entry.path !== item.path))} aria-label={`移除 ${item.name}`}><Icon name="x" /></button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={engineReady ? "描述任务，或添加文件作为上下文" : "先在左侧选择一个项目"}
            rows={2}
            disabled={!engineReady}
          />
          <ComposerControls
            engineReady={engineReady}
            streaming={streaming}
            aborting={aborting}
            canSend={engineReady && !sending && Boolean(input.trim())}
            approvalMode={approvalMode}
            runtime={runtime}
            models={models}
            thinkingLevels={thinkingLevels}
            onPickFiles={() => void pickFiles()}
            onOpenPalette={() => window.dispatchEvent(new Event("piwood:open-command-palette"))}
            onApprovalChange={(mode) => void changeApproval(mode)}
            onModelChange={(model) => void changeModel(model)}
            onThinkingChange={(level) => void changeThinking(level)}
            onCompact={() => void window.pi.engineCompact().then(refreshRuntime).catch((err) => setError(String(err)))}
            onSend={() => void send("prompt")}
            onAbort={() => void abort()}
          />
        </div>
      </div>
      {error && <div className="composer-error" role="alert">{error}</div>}
      {empty && engineReady && (
        <div className="quick-prompts" aria-label="常用任务">
          {quickPrompts.map((prompt) => (
            <PromptSuggestion key={prompt} onClick={() => { setInput(prompt); requestAnimationFrame(() => textareaRef.current?.focus()); }}>
              {prompt}
            </PromptSuggestion>
          ))}
        </div>
      )}
    </section>
  );
}
