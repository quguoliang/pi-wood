import * as React from "react";
import { Check } from "lucide-react";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: React.ReactNode;
  /** 动作按钮文案：用动词（「移除」「删除」）而非「确认」，让后果自明 */
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /**
   * 可选的「不再提醒」勾选项。勾选后随确认一并回传 true，由调用方决定是否持久化；
   * 不传则不渲染该项（即每次都要问）。
   */
  dontRemind?: { label?: string; onConfirm(checked: boolean): void };
  onConfirm(): void;
}

/**
 * 通用确认弹窗（T8.11 交互收口）：标题 + 说明 + 取消／动作两键。
 *
 * 与设置页的编辑弹窗（ProvidersSection）同一形态。用于替换「在分组列表末尾追加一条内联确认条」
 * 的旧交互——旧形态离被操作对象太远（列表越长越远），且分组折叠时确认条根本不渲染。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "取消",
  destructive,
  dontRemind,
  onConfirm,
}: ConfirmDialogProps): React.JSX.Element {
  const [dontRemindChecked, setDontRemindChecked] = React.useState(false);
  // 每次打开复位勾选态，避免上一次的勾选泄漏到下一次
  React.useEffect(() => {
    if (open) setDontRemindChecked(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {dontRemind ? (
          <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={dontRemindChecked}
              onChange={(event) => setDontRemindChecked(event.target.checked)}
            />
            <span className="grid size-3.5 shrink-0 place-items-center rounded border border-muted-foreground/40 transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground">
              {dontRemindChecked ? <Check className="size-2.5" /> : null}
            </span>
            {dontRemind.label ?? "不再提醒"}
          </label>
        ) : null}
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            size="sm"
            onClick={() => {
              dontRemind?.onConfirm(dontRemindChecked);
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
