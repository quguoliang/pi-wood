import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, Check, Copy, GitFork, OctagonX, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Markdown, ThinkingCard, ToolCard } from "@pi-wood/ui-kit";
import { activeSlice, useActiveConversation, useSessionStore, type ConversationItem } from "../../stores/session-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useConversationsStore } from "../../stores/conversations-store";
import { useSessionMetaStore } from "../../stores/session-meta-store";
import { useContextTreeStore } from "../../stores/context-tree-store";
import { groupToolRows, isToolGroup, type DisplayRow } from "../../lib/tool-groups";
import { publishOutlineAnchor } from "../../lib/outline-bus";
import { ToolGroup } from "./ToolGroup";
import { cn } from "@/lib/utils";

/* ------------------------------ 单条渲染 ------------------------------ */

const UserBubble = memo(function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-[13.5px] leading-relaxed text-secondary-foreground">
        {text}
      </div>
    </div>
  );
});

const AssistantProse = memo(function AssistantProse({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div className={cn("pk-prose max-w-none text-[13.5px]", streaming && "[&>*:last-child]:after:content-['▍'] [&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:animate-pulse [&>*:last-child]:after:text-primary")}>
      <Markdown>{text}</Markdown>
    </div>
  );
});

const SystemNote = memo(function SystemNote({
  text,
  tone,
  align = "center",
}: {
  text: string;
  tone: "info" | "warn" | "error" | "success";
  align?: "center" | "start";
}) {
  const toneCls = cn(
    tone === "warn" && "text-warning",
    tone === "error" && "text-destructive",
    tone === "success" && "text-success",
    tone === "info" && "text-muted-foreground",
  );
  if (align === "start") {
    return (
      <div className={cn("flex items-center gap-1.5 py-0.5 text-[12px]", toneCls)}>
        <OctagonX className="size-3.5" />
        <span>{text}</span>
      </div>
    );
  }
  return (
    <div className="flex justify-center">
      <div className={cn("rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-[11px]", toneCls)}>
        {text}
      </div>
    </div>
  );
});

const ToolRow = memo(function ToolRow({ item }: { item: Extract<ConversationItem, { kind: "tool" }> }) {
  const defaultOpen = useSettingsStore((s) => s.settings.ui.toolCardsDefaultOpen);
  return (
    <ToolCard
      name={item.name}
      args={item.args}
      status={item.status}
      output={item.output}
      diff={item.diff}
      diffStat={item.diffStat}
      truncated={item.truncated}
      defaultOpen={defaultOpen}
    />
  );
});

const ThinkingRow = memo(function ThinkingRow({ item }: { item: Extract<ConversationItem, { kind: "thinking" }> }) {
  const defaultOpen = useSettingsStore((s) => s.settings.ui.thinkingDefaultOpen);
  return <ThinkingCard text={item.text} durationMs={item.durationMs} preview={item.text.slice(-60)} defaultOpen={defaultOpen} />;
});

const AssistantRow = memo(function AssistantRow({ item, isLast }: { item: Extract<ConversationItem, { kind: "assistant" }>; isLast: boolean }) {
  const [copied, setCopied] = useState(false);
  const retry = useCallback(() => {
    const items = activeSlice().items;
    const idx = items.findIndex((m) => m.id === item.id);
    const lastUser = [...items.slice(0, idx)].reverse().find((m) => m.kind === "user");
    if (lastUser && lastUser.kind === "user") void window.pi.engineFollowUp(lastUser.text);
  }, [item.id]);
  /**
   * T9.2 v2.1（同日语义改判）消息级分叉：新对话 = **该回复所在轮结束前**的全部对话
   * （含被点的这条回复本身），从那里继续聊；源对话不动。
   * 渲染层只数「这是第几条用户消息之后」（user 行 ↔ user 条目天然 1:1），
   * 条目/路径定位全部交主进程 pathToLeafIds 同源完成——assistant 一轮可能裂成多个
   * 气泡/条目，按轮传序号是唯一不错位的锚法（旧版按 entryId 直传即为此坑）。
   */
  const forkHere = useCallback(async () => {
    const convId = useSessionStore.getState().activeConversationId;
    if (!convId) return;
    const items = activeSlice().items;
    const idx = items.findIndex((m) => m.id === item.id);
    if (idx < 0) return;
    let ordinal = 0;
    for (let i = 0; i < idx; i += 1) if (items[i]?.kind === "user") ordinal += 1;
    if (ordinal === 0) {
      toast.info("这条回复前没有用户提问，无从分叉");
      return;
    }
    const tree = useContextTreeStore.getState().byConv[convId];
    try {
      const res = await window.pi.engineForkToNewConversation(convId, ordinal, tree?.leafId);
      const sourceTitle = ((useConversationsStore.getState().firstUserById[convId] ?? "").replace(/\s+/g, " ").trim().slice(0, 24)) || "原对话";
      await useSessionMetaStore.getState().set(res.sessionFile, { alias: `Fork of ${sourceTitle}`, forkedFrom: res.sourceFile });
      await useConversationsStore.getState().refresh();
      useConversationsStore.getState().switchTo(res.conversationId);
      toast.success("已分叉出新对话（含这条回复），已切过去");
    } catch (err) {
      toast.error(`分叉失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [item.id]);
  return (
    <div className="group/assistant">
      <AssistantProse text={item.text} />
      <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/assistant:opacity-100">
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 text-muted-foreground hover:text-foreground"
          aria-label="复制"
          onClick={() => void navigator.clipboard.writeText(item.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 text-muted-foreground hover:text-foreground"
          aria-label="分叉"
          title="把这条回复之前的全部对话分叉成新对话（源对话不受影响）"
          onClick={() => void forkHere()}
        >
          <GitFork className="size-3.5" />
        </Button>
        {isLast && (
          <Button variant="ghost" size="icon-sm" className="size-7 text-muted-foreground hover:text-foreground" aria-label="重试" onClick={retry}>
            <RotateCcw className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
});

function ConversationRow({ item, isLast }: { item: DisplayRow; isLast: boolean }): React.JSX.Element {
  if (isToolGroup(item)) return <ToolGroup group={item} />;
  switch (item.kind) {
    case "user": return <UserBubble text={item.text} />;
    case "assistant": return <AssistantRow item={item} isLast={isLast} />;
    case "thinking": return <ThinkingRow item={item} />;
    case "tool": return <ToolRow item={item} />;
    case "system": return <SystemNote text={item.text} tone={item.tone} align={item.align} />;
  }
}

/* ------------------------------ 列表容器 ------------------------------ */

export function MessageList(): React.JSX.Element | null {
  const items = useActiveConversation((c) => c.items);
  const liveText = useActiveConversation((c) => c.liveText);
  const liveThinking = useActiveConversation((c) => c.liveThinking);
  const streaming = useActiveConversation((c) => c.streaming);
  const activeConversationId = useSessionStore((s) => s.activeConversationId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const renderedConvRef = useRef(activeConversationId);
  const [atBottom, setAtBottom] = useState(true);
  const toolGroupsEnabled = useSettingsStore((s) => s.settings.ui.toolGroupsEnabled);
  const displayRows = useMemo(() => groupToolRows(items, toolGroupsEnabled), [items, toolGroupsEnabled]);
  const lastRowId = displayRows.length > 0 ? displayRows[displayRows.length - 1].id : undefined;
  // T9.1 缩略树联动：rowsRef 供 onScroll 闭包读最新行表；flashId=被跳转行的高亮
  const rowsRef = useRef<DisplayRow[]>(displayRows);
  rowsRef.current = displayRows;
  const spyRef = useRef<string | undefined>(undefined);
  const [flashId, setFlashId] = useState<string | undefined>();

  const virtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: (i) => displayRows[i].id,
  });

  // T9.1 scroll spy：可见首行向上找最近 user 行，通知缩略树/刻度条高亮（仅变更时派发）。
  // 单独成函数：短对话/切对话时不会触发 scroll 事件，也要能出锚点（v2.2 刻度条 active 态依赖）。
  const reportSpy = useCallback(() => {
    const first = virtualizer.getVirtualItems()[0];
    const rows = rowsRef.current;
    if (!first || rows.length === 0) return;
    let idx = Math.min(first.index, rows.length - 1);
    while (idx >= 0 && rows[idx] && rows[idx].kind !== "user") idx -= 1;
    const anchor = idx >= 0 ? rows[idx] : undefined;
    if ((anchor?.id ?? undefined) !== spyRef.current) {
      spyRef.current = anchor?.id;
      publishOutlineAnchor(anchor?.id);
    }
  }, [virtualizer]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    // T8.3：滚动位置与「跟底」按对话各自记住
    const s = useSessionStore.getState();
    s.setScrollTop(el.scrollTop);
    s.setFollowBottom(bottom);
    reportSpy();
  }, [reportSpy]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    atBottomRef.current = true;
    setAtBottom(true);
  }, []);

  // 内容不足一屏（无 scroll 事件）或切对话时也要出锚点：刻度条/缩略树的 active 态依赖它
  useEffect(() => {
    spyRef.current = undefined;
    reportSpy();
  }, [reportSpy, displayRows.length, activeConversationId]);

  // T9.1 缩略树单击节点 → 跳到对应行（虚拟列表定位 + 短暂高亮；离开底部后不再自动跟底）
  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(undefined), 1200);
    return () => clearTimeout(t);
  }, [flashId]);

  useEffect(() => {
    const onJump = (e: Event): void => {
      const itemId = (e as CustomEvent<{ itemId?: string }>).detail?.itemId;
      if (!itemId) return;
      const idx = rowsRef.current.findIndex((r) => r.id === itemId);
      if (idx < 0) return;
      atBottomRef.current = false;
      setAtBottom(false);
      virtualizer.scrollToIndex(idx, { align: "center" });
      setFlashId(itemId);
    };
    window.addEventListener("piwood:outline-jump", onJump);
    return () => window.removeEventListener("piwood:outline-jump", onJump);
  }, [virtualizer]);

  // 新内容/流式增长时若在底部则跟随（live 尾块在 DOM 流末尾，滚到 scrollHeight 即可）
  useLayoutEffect(() => {
    if (renderedConvRef.current !== activeConversationId) return; // 切对话那一帧交给下面的恢复逻辑定位
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [items.length, liveText, liveThinking, streaming, activeConversationId]);

  // T8.3：切换可见对话 → 恢复该对话自己的滚动位置，只有它记住「跟底」时才贴底
  useEffect(() => {
    renderedConvRef.current = activeConversationId;
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, followBottom } = useSessionStore.getState().sliceOf(activeConversationId);
    atBottomRef.current = followBottom;
    setAtBottom(followBottom);
    const target = followBottom ? el.scrollHeight : scrollTop;
    el.scrollTop = target;
    // 虚拟列表首帧还没测完行高，下一帧按同一目标补一次
    const raf = requestAnimationFrame(() => {
      el.scrollTop = target;
    });
    return () => cancelAnimationFrame(raf);
  }, [activeConversationId]);

  const empty = items.length === 0 && !liveText && !liveThinking && !streaming;
  const rows = virtualizer.getVirtualItems();

  // 空态由居中的 Onboarding Composer 承载问候与输入框，此处不占位
  if (empty) return null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pt-6" aria-live="polite" role="log">
      {
        <div className="mx-auto w-full max-w-[var(--pk-chat-width,48rem)]">
          <div style={{ height: virtualizer.getTotalSize() }} className="relative w-full">
            {rows.map((row) => {
              const r = displayRows[row.index];
              const tight = r.kind === "tool" || r.kind === "thinking" || r.kind === "tool_group";
              return (
              <div
                key={row.key}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <div className={cn("rounded-lg", tight ? "mb-0.5" : "mb-3", r.id === flashId && "ring-1 ring-ring/50 transition-shadow")}>
                  <ConversationRow item={r} isLast={r.id === lastRowId} />
                </div>
              </div>
              );
            })}
          </div>

          {/* live 尾块：流式思考 / 流式正文（不进虚拟列表，避免每 token 重排） */}
          {(liveThinking || liveText || streaming) && (
            <div className="animate-in fade-in-0 duration-200 flex w-full flex-col gap-3 pb-2">
              {liveThinking && <ThinkingCard text={liveThinking} streaming preview={liveThinking.slice(-60)} />}
              {liveText && <AssistantProse text={liveText} streaming />}
              {streaming && !liveText && !liveThinking && (
                <div className="flex items-center gap-1 pl-1">
                  <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-primary" />
                </div>
              )}
            </div>
          )}
        </div>
      }
      <div className="h-4" />
    </div>
      {!atBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="滚动到底部"
          className="animate-in fade-in-0 duration-150 absolute bottom-4 left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-border bg-popover text-muted-foreground shadow-lg transition-[background-color,color,transform] motion-safe:active:scale-[0.95] hover:text-foreground"
        >
          <ArrowDown className="size-4" />
        </button>
      )}
    </div>
  );
}
