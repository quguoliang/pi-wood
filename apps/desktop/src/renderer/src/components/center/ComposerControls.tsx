import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { accentForThinking, approvalAccent, thinkingLabels } from "@/lib/composer-levels";
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

/**
 * 窄宽度下的「只留图标」档位。
 *
 * **必须用容器查询而不是视口断点**：本行宽度由中栏决定，中栏是可拖拽缩放的面板
 * （`minSize 25%`），与窗口宽度没有固定比例 ⇒ `sm:`／`md:` 一类视口断点会在同一个窗口里
 * 时对时错。`@min-[...]` 按本行自身宽度生效，拖拽分割条时实时重排。
 *
 * **阈值基准是内容盒**（实测：rowW 746 时查询按 734 判定，差值是本行 `px-1.5` 的 12px）——
 * 即「留给子元素的可用宽度」，正是该关心的量。
 *
 * 档位由窄到宽依次放行：上下文 % → 思考级别 → 权限文案 → 目标文案。
 * 排序依据是「单位宽度的信息量」：百分比是数字、思考级别是 1~2 字，都比「每次询问」这类
 * 四字词组便宜；「目标」是纯开关，图标（旗标）自解释，故最后放行。阈值均留有余量，
 * 使模型名在各档位保持完整（实测直到内容盒 300px 才收窄）。
 *
 * **模型名刻意不设档位**——它是这行里信息量最高的文字，靠 `shrink + truncate` 兜底，
 * 是唯一允许被压缩的元素；这样即使容器极窄也只会「模型名变短」，不会换行。
 */
const showAt = {
  context: "@min-[420px]:inline",
  thinking: "@min-[520px]:inline",
  permission: "@min-[600px]:inline",
  goal: "@min-[680px]:inline",
} as const;

/** 与 `showAt` 同档的图标（chevron）：收起时只留主图标，不显示下拉箭头 */
const showIconAt = {
  thinking: "@min-[520px]:block",
  permission: "@min-[600px]:block",
} as const;

/**
 * 极窄档（内容盒 < 320px ＝ 中栏 `minSize` 240px 附近；实测此处原本溢出 38px、发送按钮会被裁）。
 * 只压密度、**不隐藏任何控件**——收紧行内边距与间距把宽度让给模型名；刻意不在此档隐藏
 * `+`／上下文等控件：那是「功能静默消失」，比拥挤更糟，也违反本项目「不静默降级」的口径。
 *
 * 两个坑（实测踩到，改这里前先读）：
 * ① **必须叠 `has-[>svg]:` 才压得住**：`Button size="sm"` 自带 `has-[>svg]:px-2.5`，
 *    而 `:has()` 计入特异性 ⇒ 它是 (0,2,0)，普通容器查询类只有 (0,1,0)，**光靠源码顺序压不过**。
 *    故同一档要连写 `px-1`（压 `px-3`）与 `has-[>svg]:px-1`（压 `has-[>svg]:px-2.5`）两条。
 * ② **容器查询不能作用于容器自身**：本行自身带 `@container/composer`，故加在本行上的
 *    `@max-[...]:px-1` 是死规则（找不到祖先容器）——行自身的密度只能由子元素那层解决，
 *    这也是这里只收紧分组间距、不动行内边距的原因。
 */
const compact = "@max-[320px]:px-1 @max-[320px]:has-[>svg]:px-1";
/** 分组间距同样只在极窄档收紧（作用于本行的后代，查询生效） */
const compactGroup = "@max-[320px]:gap-0.5";

/**
 * 底栏芯片的统一密度（`compact` 在极窄档收紧左内边距）。
 *
 * 基类**刻意不含 `hover:text-foreground`**：权限与思考两枚芯片的文字色跟随所选档位变化
 * （配色表在 `@/lib/composer-levels`），若基类带 hover 变色，悬停瞬间会把状态色吃掉、
 * 退回中性灰，看起来像「选中的档位丢了」。需要悬停变色的中性芯片各自补 `hoverInk`。
 */
const controlBtn = cn(
  "h-8 min-w-0 gap-1.5 rounded-md px-2 text-xs font-normal text-muted-foreground hover:bg-accent",
  compact,
);

/** 中性芯片（上下文、模型）的悬停文字色；**不套用到权限／思考**——它们必须保持当前档位的颜色 */
const hoverInk = "hover:text-foreground";

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

  // 刻意不换行：宽度不足时缩文字（见 showAt），而不是把右半组挤到第二行
  return (
    <div className="@container/composer flex min-h-9 items-center justify-between gap-x-2 px-1.5 pb-1 pt-2">
      <div className={cn("flex min-w-0 shrink-0 items-center gap-1", compactGroup)}>
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
            <Button
              variant="ghost"
              size="sm"
              disabled={!props.engineReady}
              aria-label="Agent 权限"
              title={`Agent 权限：${permission.label} —— ${permission.detail}`}
              className={cn(controlBtn, approvalAccent[props.approvalMode], !props.engineReady && keepEnabledLook)}
            >
              <Icon name="shield" /><span className={cn("hidden max-w-[9rem] truncate", showAt.permission)}>{permission.label}</span><Icon name="chevronDown" className={cn("hidden", showIconAt.permission)} />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-80 gap-0.5 p-1.5">
            <div className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Agent 权限</div>
            {approvalOptions.map((item) => (
              <MenuRow key={item.mode} leading={<Icon name="shield" className={approvalAccent[item.mode]} />} title={item.label} detail={item.detail} checked={props.approvalMode === item.mode} onClick={() => { close(); props.onApprovalChange(item.mode); }} />
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
          className={cn(controlBtn, props.goalArm ? "bg-primary/15 text-primary" : hoverInk, !props.engineReady && keepEnabledLook)}
        >
          {/* 刻意不用 brain：思考级别已占用 brain，两者在同一行并排时同形无法区分。
              也刻意不用靶心（target）：它与右侧「上下文」的 CircleGauge 都是同心圆，16px 下难分辨。
              旗标是这行里唯一的角形图标，与左组 shield、右组 CircleGauge／brain 都不撞形。 */}
          <Icon name="flag" />
          <span className={cn("hidden", showAt.goal)}>{props.goalArm ? "目标模式开" : "目标"}</span>
        </Button>
      </div>

      <div className={cn("ml-auto flex min-w-0 items-center gap-1", compactGroup)}>
        <Popover open={open === "context"} onOpenChange={show("context")}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className={cn(controlBtn, hoverInk, !props.engineReady && keepEnabledLook)} disabled={!props.engineReady}>
              <Icon name="context" /><span className={cn("hidden", showAt.context)}>{usage?.percent == null ? "上下文" : `${Math.round(usage.percent)}%`}</span>
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
            <Button variant="ghost" size="sm" className={cn(controlBtn, "max-w-[12rem] shrink", hoverInk, !props.engineReady && keepEnabledLook)} disabled={!props.engineReady || props.streaming}>
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
            <Button
              variant="ghost"
              size="sm"
              disabled={!props.engineReady || props.streaming || props.thinkingLevels.length <= 1}
              title={`思考级别：${currentThinking}`}
              className={cn(controlBtn, accentForThinking(props.runtime.thinkingLevel), !props.engineReady && keepEnabledLook)}
            >
              <Icon name="brain" /><span className={cn("hidden", showAt.thinking)}>{currentThinking}</span><Icon name="chevronDown" className={cn("hidden", showIconAt.thinking)} />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-44 gap-0.5 p-1.5">
            <div className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">思考级别</div>
            {props.thinkingLevels.map((level) => (
              <MenuRow key={level} leading={<Icon name="brain" className={accentForThinking(level)} />} title={thinkingLabels[level] ?? level} checked={props.runtime.thinkingLevel === level} onClick={() => { close(); props.onThinkingChange(level); }} />
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
