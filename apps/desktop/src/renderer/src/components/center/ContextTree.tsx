import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "../ui/Icon";
import { useActiveConversation, useSessionStore } from "../../stores/session-store";
import { useSettingsStore } from "../../stores/settings-store";
import { groupToolRows } from "../../lib/tool-groups";
import { buildContextOutline, type OutlineEntry, type OutlineToolStatus } from "../../lib/context-outline";

/**
 * T9.1 上下文缩略树（v1 对话大纲，§7.10）：中栏左缘竖栏。
 * 节点=用户消息（序号圆点+首行摘要），可展开该轮的工具子行；单击跳转对应消息行
 * （`piwood:outline-jump`），高亮跟随 MessageList 的 scroll spy（`piwood:outline-active`）。
 * 显隐由 settings.ui.contextTreeEnabled 控制（ConversationHeader 按钮）；空对话不渲染。
 */

function StatusDot({ status }: { status: OutlineToolStatus }): React.JSX.Element {
  if (status === "running") return <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-warning" aria-label="进行中" />;
  if (status === "error") return <span className="size-1.5 shrink-0 rounded-full bg-destructive/80" aria-label="出错" />;
  return <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" aria-label="完成" />;
}

export function ContextTree(): React.JSX.Element | null {
  const toolGroupsEnabled = useSettingsStore((s) => s.settings.ui.toolGroupsEnabled);
  const activeConversationId = useSessionStore((s) => s.activeConversationId);
  const items = useActiveConversation((c) => c.items);
  const streaming = useActiveConversation((c) => c.streaming);
  const rows = useMemo(() => groupToolRows(items, toolGroupsEnabled), [items, toolGroupsEnabled]);
  const outline = useMemo(() => buildContextOutline(rows, { streaming }), [rows, streaming]);
  const userCount = useMemo(() => outline.filter((e) => e.kind === "user").length, [outline]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | undefined>();

  // scroll spy 高亮（MessageList 派发）；会话切换时重置展开与高亮
  useEffect(() => {
    setActiveId(undefined);
    setExpanded(new Set());
  }, [activeConversationId]);
  useEffect(() => {
    const onActive = (e: Event): void => {
      setActiveId((e as CustomEvent<{ itemId?: string }>).detail?.itemId);
    };
    window.addEventListener("piwood:outline-active", onActive);
    return () => window.removeEventListener("piwood:outline-active", onActive);
  }, []);

  const jump = (id: string): void => {
    window.dispatchEvent(new CustomEvent("piwood:outline-jump", { detail: { itemId: id } }));
  };
  const toggleExpand = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (items.length === 0) return null; // 空对话：Onboarding 空态本身无消息列表，树栏不渲染

  const tooFew = userCount < 2 && !streaming;

  return (
    <aside
      aria-label="上下文缩略树"
      className="flex w-56 shrink-0 animate-in flex-col border-r border-border/60 [animation-fill-mode:both] fade-in-0 slide-in-from-left-2 duration-150"
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/60 px-3 text-[11px] font-medium tracking-wide text-muted-foreground">
        上下文
        {userCount > 0 && <span className="tabular-nums text-muted-foreground/60">{userCount}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {tooFew ? (
          <p className="px-2 py-3 text-[11px] leading-5 text-muted-foreground">继续对话以生成大纲——每个任务与工具调用都会成为树上的一个节点。</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {outline.map((entry) => (
              <OutlineRow
                key={entry.id}
                entry={entry}
                activeId={activeId}
                expanded={expanded}
                onJump={jump}
                onToggle={toggleExpand}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function OutlineRow({
  entry,
  activeId,
  expanded,
  onJump,
  onToggle,
}: {
  entry: OutlineEntry;
  activeId: string | undefined;
  expanded: Set<string>;
  onJump(id: string): void;
  onToggle(id: string): void;
}): React.JSX.Element {
  if (entry.kind === "live") {
    return (
      <div className="flex items-center gap-2 px-1.5 py-1 text-[12px] text-muted-foreground">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
        进行中…
      </div>
    );
  }

  if (entry.kind === "system") {
    return (
      <button
        type="button"
        onClick={() => onJump(entry.id)}
        title={entry.title}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60",
          activeId === entry.id && "bg-sidebar-accent/40 text-foreground",
        )}
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            entry.tone === "error" && "bg-destructive/80",
            entry.tone === "warn" && "bg-warning",
            (entry.tone === "info" || entry.tone === "success") && "bg-muted-foreground/40",
          )}
        />
        <span className="min-w-0 flex-1 truncate">{entry.title}</span>
      </button>
    );
  }

  const isUser = entry.kind === "user";
  const hasChildren = entry.children.length > 0;
  const open = expanded.has(entry.id);
  const active = activeId === entry.id;
  const childActive = hasChildren && entry.children.some((c) => c.id === activeId);

  if (!isUser) return <></>; // 目前 OutlineEntry 只有 user/system/live

  return (
    <div>
      <button
        type="button"
        onClick={() => onJump(entry.id)}
        title={entry.title}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] text-foreground/90 transition-colors hover:bg-sidebar-accent/60",
          (active || childActive) && "bg-sidebar-accent/40 text-foreground",
        )}
      >
        <span
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-full border text-[10px] leading-none tabular-nums",
            active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground",
          )}
        >
          {entry.no}
        </span>
        <span className="min-w-0 flex-1 truncate">{entry.title}</span>
        {hasChildren && (
          <span
            role="button"
            tabIndex={-1}
            aria-label={open ? "收起工具" : "展开工具"}
            onClick={(ev) => {
              ev.stopPropagation();
              onToggle(entry.id);
            }}
            className="-mr-0.5 grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Icon name="chevronRight" className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </span>
        )}
      </button>
      {open && hasChildren && (
        // 子行展开进场（列表本体不加进场动画——随流式增长会重播闪烁，同虚拟列表约定）
        <div className="ml-[11px] animate-in border-l border-foreground/[0.07] pl-2 [animation-fill-mode:both] fade-in-0 slide-in-from-left-1 duration-150">
          {entry.children.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onJump(c.id)}
              title={c.title}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground",
                activeId === c.id && "bg-sidebar-accent/40 text-foreground",
              )}
            >
              <StatusDot status={c.status} />
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
