import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronDown, ChevronUp, FilePen, FilePlus2, Globe, ListChecks, Search,
  ShieldQuestion, Terminal, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 对话顶部「交互扩展层」：统一承接对话过程中产生的交互式行为——
 * 工具审批（approval:request）与扩展发起的 ctx.ui select/confirm/input（ui:request）。
 * 合并成一个队列，可分页（N/M）、折叠/展开；出现新项自动展开。取代旧的右下角审批浮窗与全局模态。
 */
type TrayItem =
  | { key: string; type: "approval"; id: number; title: string; message: string; toolName?: string }
  | { key: string; type: "select" | "confirm" | "input"; id: number; title: string; options?: string[]; message?: string; placeholder?: string };

function approvalIcon(toolName?: string) {
  switch (toolName) {
    case "bash":
    case "powershell":
      return Terminal;
    case "edit":
      return FilePen;
    case "write":
      return FilePlus2;
    case "grep":
    case "find":
      return Search;
    default:
      if (toolName?.startsWith("browser_")) return Globe;
      return ShieldQuestion;
  }
}

const typeLabel: Record<TrayItem["type"], string> = {
  approval: "审批",
  select: "选择",
  confirm: "确认",
  input: "输入",
};

function ApprovalBody({ toolName, message }: { toolName?: string; message: string }) {
  const terminal = toolName === "bash" || toolName === "powershell";
  if (terminal) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-[#0f1115] px-2.5 py-2 font-mono text-[12px] dark:bg-[#0b0d10]">
        <span className="select-none text-success">$</span>
        <span className="whitespace-pre-wrap break-all text-foreground/90">{message}</span>
      </div>
    );
  }
  return (
    <pre className="max-h-44 overflow-auto rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words">
      {message.split("\n").map((line, i) => (
        <span
          key={i}
          className={cn(
            "block",
            line.startsWith("−") && "text-destructive",
            line.startsWith("+") && "text-success",
            line.startsWith("文件：") && "text-foreground/80",
          )}
        >
          {line || " "}
        </span>
      ))}
    </pre>
  );
}

export function PromptTray(): React.JSX.Element | null {
  const [items, setItems] = useState<TrayItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState("");

  // 审批：approval:request
  useEffect(
    () =>
      window.pi.onApprovalRequest((d) => {
        setCollapsed(false);
        setItems((prev) => [
          ...prev,
          { key: `approval:${d.id}`, type: "approval", id: d.id, title: d.title, message: d.message, toolName: d.toolName },
        ]);
      }),
    [],
  );
  // ctx.ui：ui:request
  useEffect(
    () =>
      window.pi.onUiRequest((d) => {
        setCollapsed(false);
        setItems((prev) => [
          ...prev,
          {
            key: `ui:${d.kind}:${d.id}`,
            type: d.kind,
            id: d.id,
            title: d.title,
            options: d.options,
            message: d.message,
            placeholder: d.placeholder,
          },
        ]);
      }),
    [],
  );

  const current = items[Math.min(idx, items.length - 1)];
  useEffect(() => setDraft(""), [current?.key]);
  // 队列长度变化时把游标夹到有效范围。
  useEffect(() => {
    if (idx > items.length - 1) setIdx(Math.max(0, items.length - 1));
  }, [items.length, idx]);

  const remove = (key: string): void => setItems((prev) => prev.filter((i) => i.key !== key));

  const decideApproval = (id: number, allow: boolean): void => {
    void window.pi.approvalDecide(id, allow);
    if (current) remove(current.key);
  };
  const respondUi = (id: number, value?: string | boolean, key?: string): void => {
    void window.pi.uiRespond(id, value);
    if (key) remove(key);
  };

  const Icon = current?.type === "approval" ? approvalIcon(current.toolName) : ListChecks;

  const total = items.length;
  const position = useMemo(() => (total ? Math.min(idx + 1, total) : 0), [idx, total]);

  if (total === 0) return null;

  // 折叠态：一条细卡片（与输入框同款外壳），显示待处理数，点击展开。
  if (collapsed) {
    return (
      <section className="shrink-0 px-4 pt-2" aria-label="交互扩展层">
        <div className="mx-auto w-full max-w-[var(--pk-chat-width,48rem)]">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="mx-3 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-2xl border border-white/10 bg-[var(--composer-bg)] px-3.5 py-2.5 text-left text-xs text-muted-foreground shadow-[0_8px_22px_-16px_rgba(0,0,0,0.6)] transition-colors hover:text-foreground"
          >
            <span className="grid size-5 shrink-0 place-items-center rounded bg-primary/10 text-primary">
              <Icon className="size-3" />
            </span>
            <span className="min-w-0 flex-1 truncate">{current ? current.title : "待处理"} · {total} 项待处理</span>
            <ChevronUp className="size-3.5 shrink-0" />
            <span className="shrink-0">展开</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="shrink-0 px-4 pt-2" aria-label="交互扩展层">
      <div className="mx-auto w-full max-w-[var(--pk-chat-width,48rem)]">
        <div className="mx-3 rounded-2xl border border-white/10 bg-[var(--composer-bg)] p-1.5 shadow-[0_8px_22px_-16px_rgba(0,0,0,0.6)]">
          <div className="px-2.5 pb-2.5 pt-1.5">
        {/* 头部：类型 + 标题 + 分页 + 折叠 */}
        <div className="flex items-center gap-2">
          <span className="grid size-5 shrink-0 place-items-center rounded bg-primary/10 text-primary">
            <Icon className="size-3" />
          </span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {current ? typeLabel[current.type] : ""}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
            {current?.title}
          </span>
          {total > 1 && (
            <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
              <button type="button" disabled={idx === 0} onClick={() => setIdx((v) => Math.max(0, v - 1))} className="grid size-5 place-items-center rounded hover:bg-white/10 disabled:opacity-30" aria-label="上一项">
                <ChevronUp className="size-3.5" />
              </button>
              <span className="font-mono text-[11px]">{position}/{total}</span>
              <button type="button" disabled={idx >= total - 1} onClick={() => setIdx((v) => Math.min(total - 1, v + 1))} className="grid size-5 place-items-center rounded hover:bg-white/10 disabled:opacity-30" aria-label="下一项">
                <ChevronDown className="size-3.5" />
              </button>
            </div>
          )}
          <button type="button" onClick={() => setCollapsed(true)} className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-white/10 hover:text-foreground">
            折叠
          </button>
        </div>

        {/* 正文 */}
        {current && (
          <div className="mt-2">
            {current.type === "approval" && <ApprovalBody toolName={current.toolName} message={current.message} />}

            {current.type === "confirm" && current.message && (
              <p className="px-0.5 text-[13px] leading-relaxed text-muted-foreground">{current.message}</p>
            )}

            {current.type === "select" && (
              <div className="flex flex-col gap-1">
                {(current.options ?? []).map((option, i) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => respondUi(current.id, option, current.key)}
                    className="flex items-center gap-2.5 rounded-md border border-border/50 bg-white/[0.02] px-2.5 py-2 text-left text-[13px] text-foreground transition-colors hover:border-border hover:bg-white/[0.06]"
                  >
                    <span className="grid size-5 shrink-0 place-items-center rounded bg-muted font-mono text-[11px] text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{option}</span>
                  </button>
                ))}
              </div>
            )}

            {current.type === "input" && (
              <Input
                autoFocus
                value={draft}
                placeholder={current.placeholder}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && draft.trim() && respondUi(current.id, draft, current.key)}
              />
            )}
          </div>
        )}

        {/* 动作区 */}
        {current && (
          <div className="mt-2.5 flex items-center justify-end gap-2">
            {current.type === "approval" && (
              <>
                <Button size="sm" variant="ghost" className="gap-1 text-muted-foreground" onClick={() => respondUi(current.id, undefined, current.key)}>
                  <X className="size-3.5" />
                  跳过
                </Button>
                <Button size="sm" variant="destructive" onClick={() => decideApproval(current.id, false)}>拒绝</Button>
                <Button size="sm" onClick={() => decideApproval(current.id, true)}>允许</Button>
              </>
            )}
            {current.type === "confirm" && (
              <>
                <Button size="sm" variant="outline" onClick={() => respondUi(current.id, false, current.key)}>取消</Button>
                <Button size="sm" onClick={() => respondUi(current.id, true, current.key)}>确认</Button>
              </>
            )}
            {current.type === "select" && (
              <Button size="sm" variant="outline" onClick={() => respondUi(current.id, undefined, current.key)}>取消</Button>
            )}
            {current.type === "input" && (
              <>
                <Button size="sm" variant="outline" onClick={() => respondUi(current.id, undefined, current.key)}>取消</Button>
                <Button size="sm" disabled={!draft.trim()} onClick={() => respondUi(current.id, draft, current.key)}>提交</Button>
              </>
            )}
          </div>
        )}
          </div>
        </div>
      </div>
    </section>
  );
}
