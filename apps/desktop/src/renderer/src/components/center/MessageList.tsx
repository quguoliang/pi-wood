import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, Check, Copy, OctagonX, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown, ThinkingCard, ToolCard } from "@pi-wood/ui-kit";
import { useSessionStore, type ConversationItem } from "../../stores/session-store";
import { useSettingsStore } from "../../stores/settings-store";
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
  return <ThinkingCard text={item.text} durationMs={item.durationMs} defaultOpen={defaultOpen} />;
});

const AssistantRow = memo(function AssistantRow({ item, isLast }: { item: Extract<ConversationItem, { kind: "assistant" }>; isLast: boolean }) {
  const [copied, setCopied] = useState(false);
  const retry = useCallback(() => {
    const { items } = useSessionStore.getState();
    const idx = items.findIndex((m) => m.id === item.id);
    const lastUser = [...items.slice(0, idx)].reverse().find((m) => m.kind === "user");
    if (lastUser && lastUser.kind === "user") void window.pi.engineFollowUp(lastUser.text);
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
        {isLast && (
          <Button variant="ghost" size="icon-sm" className="size-7 text-muted-foreground hover:text-foreground" aria-label="重试" onClick={retry}>
            <RotateCcw className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
});

function ConversationRow({ item, isLast }: { item: ConversationItem; isLast: boolean }): React.JSX.Element {
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
  const items = useSessionStore((s) => s.items);
  const liveText = useSessionStore((s) => s.liveText);
  const liveThinking = useSessionStore((s) => s.liveThinking);
  const streaming = useSessionStore((s) => s.streaming);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const lastId = items.length > 0 ? items[items.length - 1].id : undefined;
  const firstId = items[0]?.id;

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: (i) => items[i].id,
  });

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    atBottomRef.current = true;
    setAtBottom(true);
  }, []);

  // 新内容/流式增长时若在底部则跟随（live 尾块在 DOM 流末尾，滚到 scrollHeight 即可）
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [items.length, liveText, liveThinking, streaming]);

  // 会话切换：立即跳到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      atBottomRef.current = true;
    }
  }, [firstId]);

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
            {rows.map((row) => (
              <div
                key={row.key}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <div className={items[row.index].kind === "tool" || items[row.index].kind === "thinking" ? "mb-0.5" : "mb-3"}>
                  <ConversationRow item={items[row.index]} isLast={items[row.index].id === lastId} />
                </div>
              </div>
            ))}
          </div>

          {/* live 尾块：流式思考 / 流式正文（不进虚拟列表，避免每 token 重排） */}
          {(liveThinking || liveText || streaming) && (
            <div className="flex w-full flex-col gap-3 pb-2">
              {liveThinking && <ThinkingCard text={liveThinking} streaming />}
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
          className="absolute bottom-4 left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-border bg-popover text-muted-foreground shadow-lg transition-colors hover:text-foreground"
        >
          <ArrowDown className="size-4" />
        </button>
      )}
    </div>
  );
}
