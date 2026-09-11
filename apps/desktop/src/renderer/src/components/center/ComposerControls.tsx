import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
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
  /** 供应商 id → 显示名（内置 + 自定义）；模型下拉按供应商分组时用作组标题 */
  providerNames?: Record<string, string>;
  thinkingLevels: string[];
  onPickFiles(): void;
  onOpenPalette(): void;
  onApprovalChange(mode: ApprovalMode): void;
  onModelChange(model: { provider: string; id: string }): void;
  onThinkingChange(level: string): void;
  onCompact(): void;
  onSend(): void;
  onAbort(): void;
  goalArm: boolean;
  onToggleGoal(): void;
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

const formatCount = (value: number): string => (value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value));

/** 模型按供应商分组（保持首次出现顺序），供下拉按组渲染 */
function groupModelsByProvider(models: Array<{ provider: string; id: string }>): Array<{ provider: string; models: Array<{ provider: string; id: string }> }> {
  const order: string[] = [];
  const byProvider = new Map<string, Array<{ provider: string; id: string }>>();
  for (const m of models) {
    let bucket = byProvider.get(m.provider);
    if (!bucket) {
      bucket = [];
      byProvider.set(m.provider, bucket);
      order.push(m.provider);
    }
    bucket.push(m);
  }
  return order.map((provider) => ({ provider, models: byProvider.get(provider) ?? [] }));
}

const controlBtn = "h-8 gap-1.5 rounded-md px-2 text-xs font-normal text-muted-foreground hover:bg-accent hover:text-foreground";

/**
 * 引擎未就绪期间（典型＝切对话的 1~2s，engineReady 被置 false 防 prompt 打进旧会话），
 * 这些芯片会被短暂 disabled——若跟着全局 Button 的 disabled:opacity-50 走，
 * 底栏就整体闪暗再亮回（与模型名闪回「选择模型」占位同源，用户报障「切对话底部闪动」）。
 * 故压掉这一档的透明度（pointer-events-none 仍在，点不动）；streaming 导致的禁用
 * **不**套用本类——那是长态，「不可点」需要可见线索。
 */
const keepEnabledLook = "disabled:opacity-100";

function MenuRow({ leading, title, detail, checked, kbd, onClick, disabled }: { leading?: React.ReactNode; title: string; detail?: string; checked?: boolean; kbd?: string; onClick(): void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40">
      {leading ? <span className="text-muted-foreground">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-foreground">{title}</span>
        {detail ? <span className="block text-[11px] text-muted-foreground">{detail}</span> : null}
      </span>
      {kbd ? <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{kbd}</kbd> : null}
      {checked ? <Icon name="check" className="text-success" /> : null}
    </button>
  );
}

export function ComposerControls(props: ComposerControlsProps): React.JSX.Element {
  const [open, setOpen] = useState<null | "add" | "permission" | "context" | "model" | "thinking">(null);
  const permission = approvalOptions.find((item) => item.mode === props.approvalMode) ?? approvalOptions[0];
  const currentModel = props.runtime.model?.split("/").pop() ?? "选择模型";
  const currentThinking = thinkingLabels[props.runtime.thinkingLevel ?? ""] ?? props.runtime.thinkingLevel ?? "思考";
  const usage = props.runtime.contextUsage;
  const show = (menu: typeof open) => (v: boolean) => setOpen(v ? menu : null);
  const close = () => setOpen(null);

  return (
    <div className="flex min-h-9 items-center justify-between gap-2 px-1.5 pb-1 pt-2">
      <div className="flex items-center gap-1">
        <Popover open={open === "add"} onOpenChange={show("add")}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label="添加内容">
              <Icon name="add" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-72 gap-1 p-1.5">
            <MenuRow leading={<Icon name="paperclip" />} title="添加文件" detail="代码、文本或图片将随消息发送" onClick={() => { close(); props.onPickFiles(); }} />
            <MenuRow leading={<Icon name="command" />} title="命令面板" detail="选择项目、模型或打开设置" kbd="⌘⇧P" onClick={() => { close(); props.onOpenPalette(); }} />
            <div className="my-1 h-px bg-border" />
            <div className="px-2 py-1 text-[11px] text-muted-foreground">
              <div className="mb-1 flex items-center gap-1.5 text-foreground"><Icon name="keyboard" /> 键盘操作</div>
              <div className="grid grid-cols-[1fr_auto] gap-1"><span>发送</span><kbd className="text-right">Enter</kbd><span>换行</span><kbd className="text-right">Shift Enter</kbd><span>生成时排队</span><kbd className="text-right">Alt Enter</kbd></div>
            </div>
          </PopoverContent>
        </Popover>

        <Popover open={open === "permission"} onOpenChange={show("permission")}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" disabled={!props.engineReady} className={cn(controlBtn, "text-warning hover:text-warning", !props.engineReady && keepEnabledLook)} aria-label="Agent 权限">
              <Icon name="shield" /><span className="max-w-[9rem] truncate">{permission.label}</span><Icon name="chevronDown" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-80 gap-0.5 p-1.5">
            <div className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Agent 权限</div>
            {approvalOptions.map((item) => (
              <MenuRow key={item.mode} leading={<Icon name="shield" />} title={item.label} detail={item.detail} checked={props.approvalMode === item.mode} onClick={() => { close(); props.onApprovalChange(item.mode); }} />
            ))}
          </PopoverContent>
        </Popover>

        <Button
          variant="ghost"
          size="sm"
          disabled={!props.engineReady || props.streaming}
          onClick={props.onToggleGoal}
          aria-pressed={props.goalArm}
          title="开启后，本次输入作为目标交给 agent 自主推进（小模型审计进度并自动续跑）"
          className={cn(controlBtn, props.goalArm && "bg-primary/15 text-primary hover:text-primary", !props.engineReady && keepEnabledLook)}
        >
          <Icon name="brain" />
          <span>{props.goalArm ? "目标模式开" : "目标"}</span>
        </Button>
      </div>

      <div className="flex items-center gap-1">
        <Popover open={open === "context"} onOpenChange={show("context")}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className={cn(controlBtn, !props.engineReady && keepEnabledLook)} disabled={!props.engineReady}>
              <Icon name="context" /><span>{usage?.percent == null ? "上下文" : `${Math.round(usage.percent)}%`}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-72 gap-0.5 p-1.5">
            <div className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">当前上下文</div>
            {usage ? (
              <div className="px-2.5 pb-2">
                <div className="flex items-baseline gap-1"><strong className="text-lg font-semibold">{usage.tokens == null ? "待统计" : formatCount(usage.tokens)}</strong><span className="text-xs text-muted-foreground">/ {formatCount(usage.contextWindow)} tokens</span></div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, usage.percent ?? 0)}%` }} /></div>
                <small className="mt-1 block text-[11px] text-muted-foreground">{usage.percent == null ? "下一次模型响应后更新" : `已使用 ${Math.round(usage.percent)}%`}</small>
              </div>
            ) : <p className="px-2.5 pb-2 text-[11px] text-muted-foreground">发送第一条消息后显示真实上下文用量。</p>}
            <MenuRow leading={<Icon name="context" />} title="压缩上下文" detail="调用 Pi 的 compact，保留摘要并释放窗口" disabled={props.streaming || !usage} onClick={() => { close(); props.onCompact(); }} />
          </PopoverContent>
        </Popover>

        <Popover open={open === "model"} onOpenChange={show("model")}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className={cn(controlBtn, "max-w-[12rem]", !props.engineReady && keepEnabledLook)} disabled={!props.engineReady || props.streaming}>
              <span className="truncate">{currentModel}</span><Icon name="chevronDown" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-80 gap-0.5 p-1.5">
            <div className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">本项目可用模型</div>
            {props.models.length === 0 && <p className="px-2.5 pb-2 text-[11px] text-muted-foreground">未从 Pi ModelRuntime 获取到模型。</p>}
            <div className="max-h-72 overflow-auto">
              {groupModelsByProvider(props.models).map((group, gi) => (
                <div key={group.provider} className={cn(gi > 0 && "mt-1.5 border-t border-border/60 pt-0.5")}>
                  <div className="sticky top-0 flex items-center gap-1.5 bg-popover px-2.5 pb-0.5 pt-2 text-[11px] font-medium text-muted-foreground">
                    <span className="truncate">{props.providerNames?.[group.provider] ?? group.provider}</span>
                    <span className="text-muted-foreground/50">{group.models.length}</span>
                  </div>
                  {group.models.map((model) => {
                    const key = `${model.provider}/${model.id}`;
                    return <MenuRow key={key} title={model.id} checked={props.runtime.model === key} onClick={() => { close(); props.onModelChange(model); }} />;
                  })}
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Popover open={open === "thinking"} onOpenChange={show("thinking")}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className={cn(controlBtn, !props.engineReady && keepEnabledLook)} disabled={!props.engineReady || props.streaming || props.thinkingLevels.length <= 1}>
              <Icon name="brain" /><span>{currentThinking}</span><Icon name="chevronDown" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-44 gap-0.5 p-1.5">
            <div className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">思考级别</div>
            {props.thinkingLevels.map((level) => (
              <MenuRow key={level} title={thinkingLabels[level] ?? level} checked={props.runtime.thinkingLevel === level} onClick={() => { close(); props.onThinkingChange(level); }} />
            ))}
          </PopoverContent>
        </Popover>

        {props.streaming ? (
          <Button size="icon-sm" onClick={props.onAbort} disabled={props.aborting} aria-label="中断当前对话" className="ml-0.5 rounded-full bg-secondary text-secondary-foreground hover:bg-secondary/80">
            <Icon name="stop" />
          </Button>
        ) : (
          <Button
            size="icon-sm"
            onClick={props.onSend}
            aria-label="发送消息"
            className={cn(
              "ml-0.5 rounded-full",
              props.canSend ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-secondary text-muted-foreground",
            )}
          >
            <Icon name="arrowUp" />
          </Button>
        )}
      </div>
    </div>
  );
}
