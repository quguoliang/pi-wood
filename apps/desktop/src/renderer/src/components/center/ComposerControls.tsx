import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";

export type ApprovalMode = "auto" | "highRisk" | "allAsk" | "denyAll";

export interface RuntimeState {
  sessionId?: string;
  model?: string;
  thinkingLevel?: string;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

interface ComposerControlsProps {
  engineReady: boolean;
  streaming: boolean;
  aborting: boolean;
  canSend: boolean;
  approvalMode: ApprovalMode;
  runtime: RuntimeState;
  models: Array<{ provider: string; id: string }>;
  thinkingLevels: string[];
  onPickFiles(): void;
  onOpenPalette(): void;
  onApprovalChange(mode: ApprovalMode): void;
  onModelChange(model: { provider: string; id: string }): void;
  onThinkingChange(level: string): void;
  onCompact(): void;
  onSend(): void;
  onAbort(): void;
}

const approvalOptions: Array<{ mode: ApprovalMode; label: string; detail: string }> = [
  { mode: "highRisk", label: "高风险时询问", detail: "执行命令、写入或编辑文件前确认" },
  { mode: "allAsk", label: "每次询问", detail: "除只读检索外，所有工具操作都确认" },
  { mode: "auto", label: "完全访问", detail: "自动执行；敏感路径仍由安全门拦截" },
  { mode: "denyAll", label: "只读模式", detail: "仅允许 read、ls、find 和 grep" },
];

const thinkingLabels: Record<string, string> = {
  off: "关闭", minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "很高", max: "最高",
};

const formatCount = (value: number): string => value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value);

export function ComposerControls(props: ComposerControlsProps): React.JSX.Element {
  const [open, setOpen] = useState<"add" | "permission" | "context" | "model" | "thinking" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const permission = approvalOptions.find((item) => item.mode === props.approvalMode) ?? approvalOptions[0];
  const currentModel = props.runtime.model?.split("/").pop() ?? "选择模型";
  const currentThinking = thinkingLabels[props.runtime.thinkingLevel ?? ""] ?? props.runtime.thinkingLevel ?? "思考";
  const usage = props.runtime.contextUsage;

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(null);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
  }, [open]);

  const toggle = (menu: typeof open, trigger: HTMLButtonElement): void => {
    triggerRef.current = trigger;
    setOpen((value) => value === menu ? null : menu);
  };

  const closeMenu = (): void => {
    setOpen(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <div className="composer-controls" ref={rootRef}>
      <div className="composer-control-group composer-control-left">
        <button className={`composer-control icon-only${open === "add" ? " active" : ""}`} type="button" onClick={(event) => toggle("add", event.currentTarget)} aria-haspopup="dialog" aria-expanded={open === "add"} aria-label="添加内容" title="添加内容"><Icon name="add" /></button>
        <button className={`composer-control permission-control${open === "permission" ? " active" : ""}`} type="button" onClick={(event) => toggle("permission", event.currentTarget)} aria-haspopup="dialog" aria-expanded={open === "permission"}>
          <Icon name="shield" /><span>{permission.label}</span><Icon name="chevronDown" />
        </button>
      </div>

      <div className="composer-control-group composer-control-right">
        <button className={`composer-control compact-control${open === "context" ? " active" : ""}`} type="button" disabled={!props.engineReady} onClick={(event) => toggle("context", event.currentTarget)} aria-haspopup="dialog" aria-expanded={open === "context"} title="当前上下文">
          <Icon name="context" /><span>{usage?.percent == null ? "上下文" : `${Math.round(usage.percent)}%`}</span>
        </button>
        <button className={`composer-control model-control${open === "model" ? " active" : ""}`} type="button" disabled={!props.engineReady || props.streaming} onClick={(event) => toggle("model", event.currentTarget)} aria-haspopup="dialog" aria-expanded={open === "model"}>
          <span>{currentModel}</span><Icon name="chevronDown" />
        </button>
        <button className={`composer-control thinking-control${open === "thinking" ? " active" : ""}`} type="button" disabled={!props.engineReady || props.streaming || props.thinkingLevels.length <= 1} onClick={(event) => toggle("thinking", event.currentTarget)} aria-haspopup="dialog" aria-expanded={open === "thinking"} title={props.thinkingLevels.length <= 1 ? "当前模型不支持可调思考级别" : "思考级别"}>
          <Icon name="brain" /><span>{currentThinking}</span><Icon name="chevronDown" />
        </button>
        {props.streaming ? (
          <button className="composer-submit is-running" type="button" onClick={props.onAbort} disabled={props.aborting} aria-label="中断当前对话" title="正在生成，点击中断"><Icon name="stop" /></button>
        ) : (
          <button className="composer-submit" type="button" onClick={props.onSend} disabled={!props.canSend} aria-label="发送消息" title="发送消息"><Icon name="arrowUp" /></button>
        )}
      </div>

      {open === "add" && (
        <div className="composer-menu menu-add" role="dialog" aria-label="添加内容" ref={menuRef}>
          <button type="button" onClick={() => { closeMenu(); props.onPickFiles(); }}><Icon name="paperclip" /><span><b>添加文件</b><small>代码、文本或图片将随消息发送</small></span></button>
          <button type="button" onClick={() => { closeMenu(); props.onOpenPalette(); }}><Icon name="command" /><span><b>命令面板</b><small>选择项目、模型或打开设置</small></span><kbd>⌘⇧P</kbd></button>
          <div className="menu-separator" />
          <div className="shortcut-list"><span><Icon name="keyboard" /> 键盘操作</span><small><kbd>Enter</kbd> 发送</small><small><kbd>Shift Enter</kbd> 换行</small><small><kbd>Alt Enter</kbd> 生成时排队</small></div>
        </div>
      )}

      {open === "permission" && (
        <div className="composer-menu menu-permission" role="dialog" aria-label="Agent 权限" ref={menuRef}>
          <div className="menu-heading">Agent 权限</div>
          {approvalOptions.map((item) => (
            <button key={item.mode} type="button" aria-pressed={props.approvalMode === item.mode} onClick={() => { closeMenu(); props.onApprovalChange(item.mode); }}>
              <Icon name="shield" /><span><b>{item.label}</b><small>{item.detail}</small></span>{props.approvalMode === item.mode && <Icon name="check" />}
            </button>
          ))}
        </div>
      )}

      {open === "context" && (
        <div className="composer-menu menu-context" role="dialog" aria-label="当前上下文" ref={menuRef}>
          <div className="menu-heading">当前上下文</div>
          {usage ? (
            <div className="context-meter">
              <div><strong>{usage.tokens == null ? "待统计" : formatCount(usage.tokens)}</strong><span>/ {formatCount(usage.contextWindow)} tokens</span></div>
              <div className="context-track"><i style={{ width: `${Math.min(100, usage.percent ?? 0)}%` }} /></div>
              <small>{usage.percent == null ? "下一次模型响应后更新" : `已使用 ${Math.round(usage.percent)}%`}</small>
            </div>
          ) : <p className="menu-empty">发送第一条消息后显示真实上下文用量。</p>}
          <button type="button" disabled={props.streaming || !usage} onClick={() => { closeMenu(); props.onCompact(); }}><Icon name="context" /><span><b>压缩上下文</b><small>调用 Pi 的 compact，保留摘要并释放窗口</small></span></button>
        </div>
      )}

      {open === "model" && (
        <div className="composer-menu menu-model" role="dialog" aria-label="选择模型" ref={menuRef}>
          <div className="menu-heading">本项目可用模型</div>
          {props.models.length === 0 && <p className="menu-empty">未从 Pi ModelRuntime 获取到模型。</p>}
          <div className="model-menu-list">
            {props.models.map((model) => {
              const key = `${model.provider}/${model.id}`;
              return <button key={key} type="button" aria-pressed={props.runtime.model === key} onClick={() => { closeMenu(); props.onModelChange(model); }}><span><b>{model.id}</b><small>{model.provider}</small></span>{props.runtime.model === key && <Icon name="check" />}</button>;
            })}
          </div>
        </div>
      )}

      {open === "thinking" && (
        <div className="composer-menu menu-thinking" role="dialog" aria-label="思考级别" ref={menuRef}>
          <div className="menu-heading">思考级别</div>
          {props.thinkingLevels.map((level) => (
            <button key={level} type="button" aria-pressed={props.runtime.thinkingLevel === level} onClick={() => { closeMenu(); props.onThinkingChange(level); }}><span><b>{thinkingLabels[level] ?? level}</b></span>{props.runtime.thinkingLevel === level && <Icon name="check" />}</button>
          ))}
        </div>
      )}
    </div>
  );
}
