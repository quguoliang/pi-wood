import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, Check, ChevronDown, CircleCheck, CircleX, Copy, GitFork, OctagonX, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Icon } from "../ui/Icon";
import { Markdown, ThinkingCard, ToolCard, createMarkdownComponents } from "@pi-wood/ui-kit";
import { activeSlice, useActiveConversation, useSessionStore, type ConversationItem, type MessageAttachment, type MessageSnippet } from "../../stores/session-store";
import { useAssistStore } from "../../stores/assist-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useConversationsStore } from "../../stores/conversations-store";
import { useSessionMetaStore } from "../../stores/session-meta-store";
import { useContextTreeStore } from "../../stores/context-tree-store";
import { collapseTurnProcess, groupToolRows, isToolGroup, isTurnProcess, type DisplayRow, type TurnProcessItem } from "../../lib/tool-groups";
import { publishOutlineAnchor } from "../../lib/outline-bus";
import { ToolGroup } from "./ToolGroup";
import { ConversationAssist } from "./ConversationAssist";
import { AttachmentPreviewBody, ChipPreview, SnippetPreviewBody } from "./ChipPreview";
import { openWorkbenchFile } from "../../stores/workbench-store";
import { cn } from "@/lib/utils";

/* ------------------------------ 单条渲染 ------------------------------ */

/** 气泡内的附件芯片：图片给缩略图（点击大图预览）；hover 统一走 ChipPreview 卡片 */
function BubbleAttachmentChip({ item, onPreview }: { item: MessageAttachment; onPreview: (item: MessageAttachment) => void }): React.JSX.Element {
  const isImage = item.kind === "image";
  return (
    <ChipPreview
      className="flex h-7 max-w-52 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2 text-xs text-muted-foreground"
      ariaLabel={`附件 ${item.name}`}
      onClick={() => (isImage && item.thumb ? onPreview(item) : openWorkbenchFile(item.path))}
      preview={<AttachmentPreviewBody name={item.name} path={item.path} size={item.size} kind={item.kind} thumb={item.thumb} />}
    >
      {isImage && item.thumb ? (
        <img src={item.thumb} alt="" className="size-4 shrink-0 rounded-[3px] object-cover" />
      ) : (
        <Icon name={isImage ? "image" : "file"} className="size-3.5 shrink-0" />
      )}
      <span className="truncate">{item.name}</span>
    </ChipPreview>
  );
}

/** 气泡内的引用片段芯片：hover 看代码位置与内容，点击回跳文件面板对应行 */
function BubbleSnippetChip({ snippet }: { snippet: MessageSnippet }): React.JSX.Element {
  return (
    <ChipPreview
      className="flex h-7 max-w-52 cursor-pointer items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 text-xs text-foreground"
      ariaLabel={`引用 ${snippet.name} ${snippet.start}-${snippet.end} 行`}
      onClick={() => openWorkbenchFile(snippet.path, snippet.start)}
      preview={<SnippetPreviewBody path={snippet.path} start={snippet.start} end={snippet.end} snippet={snippet.snippet} />}
    >
      <Icon name="file" className="size-3.5 shrink-0 text-primary" />
      <span className="truncate">
        {snippet.name}
        <span className="ml-1 font-mono text-muted-foreground">
          {snippet.start}-{snippet.end}
        </span>
      </span>
    </ChipPreview>
  );
}

const UserBubble = memo(function UserBubble({
  text,
  attachments,
  snippets,
}: {
  text: string;
  attachments?: MessageAttachment[];
  snippets?: MessageSnippet[];
}) {
  // ZCode 用户消息形态：rounded-xl + 右上角收尖（rounded-tr-xs）+ 描边卡 + 限宽 max-w-xl
  const [preview, setPreview] = useState<MessageAttachment | null>(null);
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-xl rounded-tr-xs border border-border bg-surface px-4 py-3 text-[14.5px] leading-relaxed text-secondary-foreground">
        {(attachments?.length || snippets?.length) && (
          <div className={cn("flex flex-wrap gap-1.5", text.trim() && "mb-2")} aria-label="本条消息的附件与引用">
            {attachments?.map((a) => <BubbleAttachmentChip key={a.path} item={a} onPreview={setPreview} />)}
            {snippets?.map((s) => <BubbleSnippetChip key={`${s.path}:${s.start}-${s.end}`} snippet={s} />)}
          </div>
        )}
        {text.trim() ? <div className="whitespace-pre-wrap break-words">{text}</div> : null}
      </div>
      {/* 图片大图预览（点击缩略图芯片打开） */}
      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-3xl p-3" aria-label={preview?.name ?? "图片预览"}>
          {preview?.thumb ? <img src={preview.thumb} alt={preview.name} className="max-h-[75vh] w-auto self-center rounded-md object-contain" /> : null}
          <p className="truncate text-center text-xs text-muted-foreground">{preview?.name}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
});

const AssistantProse = memo(function AssistantProse({ text, streaming }: { text: string; streaming?: boolean }) {
  /**
   * T11.1 生成式 UI：只有**开关打开且这一轮已结束**时才把 ```genui 围栏换成沙箱 UI。
   * 流式期间刻意走普通代码块——否则每个 token 都会重建一次 iframe（内容半截 + 抖动 + 白烧 CPU）。
   * renderKey 把「开关状态」带进分块 memo：用户中途切换开关时历史消息要重新解析，
   * 而 MemoizedMarkdownBlock 只按 content 比较，不给键就会静默不刷新。
   */
  const genUi = useSettingsStore((s) => s.settings.ui.generativeUi);
  const genUiActive = genUi && !streaming;
  const components = useMemo(() => createMarkdownComponents({ genUi: genUiActive }), [genUiActive]);
  return (
    <div
      className={cn("pk-prose max-w-none text-[14.5px]", streaming && "[&>*:last-child]:after:content-['▍'] [&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:animate-pulse [&>*:last-child]:after:text-primary")}
      data-pk-stream-marker={streaming || undefined}
    >
      <Markdown components={components} renderKey={genUiActive ? "genui-on" : "genui-off"}>
        {text}
      </Markdown>
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
  // ZCode timelineMarker 形态：两侧发丝线（bg-border/50）+ 居中弱化标签，融入输出流而不是胶囊浮标
  return (
    <div className="flex w-full items-center gap-3 px-1 py-1.5">
      <div aria-hidden className="h-px min-w-8 flex-1 bg-border/50" />
      <span className={cn("inline-flex min-w-0 shrink items-center justify-center gap-1.5 text-center text-[11.5px] leading-5", toneCls)}>
        <OctagonX className="size-3.5 shrink-0" />
        <span className="min-w-0 break-words">{text}</span>
      </span>
      <div aria-hidden className="h-px min-w-8 flex-1 bg-border/50" />
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

const AssistantRow = memo(function AssistantRow({ item, isLatest }: { item: Extract<ConversationItem, { kind: "assistant" }>; isLatest: boolean }) {
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
      {/* 操作栏：最新一轮回答常驻可见（鼠标不在消息上也能看到），历史回答仍 hover 才显；
          用 opacity 而非条件渲染 —— 显隐都不改占位，列表高度与滚动位置不会跳 */}
      <div
        className={cn(
          "mt-1 flex items-center gap-0.5 transition-opacity",
          isLatest ? "opacity-100" : "opacity-0 group-hover/assistant:opacity-100 group-focus-within/assistant:opacity-100",
        )}
      >
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
        {isLatest && (
          <Button variant="ghost" size="icon-sm" className="size-7 text-muted-foreground hover:text-foreground" aria-label="重试" onClick={retry}>
            <RotateCcw className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
});

function ConversationRow({ item, isLatest }: { item: DisplayRow; isLatest: boolean }): React.JSX.Element {
  if (isToolGroup(item)) return <ToolGroup group={item} />;
  if (isTurnProcess(item)) return <TurnProcessRow turn={item} />;
  switch (item.kind) {
    case "user": return <UserBubble text={item.text} attachments={item.attachments} snippets={item.snippets} />;
    case "assistant": return <AssistantRow item={item} isLatest={isLatest} />;
    case "thinking": return <ThinkingRow item={item} />;
    case "tool": return <ToolRow item={item} />;
    case "system": return <SystemNote text={item.text} tone={item.tone} align={item.align} />;
  }
}

function fmtTurnDuration(ms?: number): string {
  if (!ms || ms < 1000) return "";
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

/**
 * T10 轮次过程折叠行：一轮跑完后，思考 / 工具过程收成这一行（正文留在它下方）。
 * 默认收起——用户要的正是「完成后只看到正文」；展开按原顺序还原全部过程行。
 */
const TurnProcessRow = memo(function TurnProcessRow({ turn }: { turn: TurnProcessItem }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const duration = fmtTurnDuration(turn.durationMs);
  const failed = turn.errorCount > 0;
  const steps = [
    turn.thinkingCount > 0 ? `${turn.thinkingCount} 次思考` : "",
    turn.toolCount > 0 ? `${turn.toolCount} 个工具调用` : "",
  ].filter(Boolean).join(" · ");
  return (
    <div className="group/tp">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? "收起本轮过程" : "展开本轮思考与工具调用"}
        className="-mx-2 inline-flex max-w-full min-w-0 items-center gap-2 self-start rounded-lg px-2 py-1.5 text-left text-[13.5px] text-muted-foreground transition-colors hover:bg-accent/50"
      >
        {failed ? (
          <CircleX className="size-4 shrink-0 text-destructive/70" />
        ) : (
          <CircleCheck className="size-4 shrink-0 text-success/80" />
        )}
        <span className="shrink-0 font-medium text-foreground/80">{failed ? `已完成 · ${turn.errorCount} 个失败` : "已完成"}</span>
        {duration && <span className="shrink-0 text-muted-foreground/70">· {duration}</span>}
        {steps && <span className="min-w-0 truncate text-muted-foreground/70">· {steps}</span>}
        <ChevronDown
          className={cn("shrink-0 transition", open ? "opacity-100 rotate-180" : "opacity-0 group-hover/tp:opacity-100")}
          size={14}
        />
      </button>
      {open && (
        <div className="mt-0.5 mb-1 ml-[7px] max-h-[360px] space-y-0.5 overflow-y-auto border-l-2 border-border pl-3">
          {turn.rows.map((row) => (
            <ConversationRow key={row.id} item={row} isLatest={false} />
          ))}
        </div>
      )}
    </div>
  );
});

/* ------------------------------ 列表容器 ------------------------------ */

export function MessageList(): React.JSX.Element | null {
  const items = useActiveConversation((c) => c.items);
  const liveText = useActiveConversation((c) => c.liveText);
  const liveThinking = useActiveConversation((c) => c.liveThinking);
  const streaming = useActiveConversation((c) => c.streaming);
  const historyLoaded = useActiveConversation((c) => c.historyLoaded);
  const activeConversationId = useSessionStore((s) => s.activeConversationId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const renderedConvRef = useRef(activeConversationId);
  const [atBottom, setAtBottom] = useState(true);
  const toolGroupsEnabled = useSettingsStore((s) => s.settings.ui.toolGroupsEnabled);
  const thinkingDefaultOpen = useSettingsStore((s) => s.settings.ui.thinkingDefaultOpen);
  // T7.9 会话辅助块贴在流末尾，它到达的时机要在下面补一次贴底（见对应 effect）
  const assistSession = useAssistStore((s) => s.session);
  const assistForItemsLen = useAssistStore((s) => s.forItemsLen);
  // 两级变换：连续工具先成组，再把**已结束轮次**的思考/工具过程折叠成一行（T10）。
  // streaming 参与依赖：轮次跑完那一刻（streaming→false）历史过程自动收起，只留正文。
  const displayRows = useMemo(
    () => collapseTurnProcess(groupToolRows(items, toolGroupsEnabled), streaming),
    [items, toolGroupsEnabled, streaming],
  );
  /**
   * 「最新一轮回复」= 最后一条 assistant 行，而不是「最后一行」——一轮收尾后仍可能尾随
   * system 提示或工具卡，按最后一行判断会让重试按钮凭空消失。它用于两处：
   * 底部操作栏常驻可见（历史行仍 hover 才显）、重试按钮只挂它。
   */
  const latestAssistantId = useMemo(() => {
    for (let i = displayRows.length - 1; i >= 0; i -= 1) {
      const r = displayRows[i];
      if (r?.kind === "assistant") return r.id;
    }
    return undefined;
  }, [displayRows]);
  // T9.1 缩略树联动：rowsRef 供 onScroll 闭包读最新行表；flashId=被跳转行的高亮
  const rowsRef = useRef<DisplayRow[]>(displayRows);
  rowsRef.current = displayRows;
  const spyRef = useRef<string | undefined>(undefined);
  const [flashId, setFlashId] = useState<string | undefined>();
  // ZCode 输出流同步：已播过进入动画的行（key=convId:rowId），滚动回挂/历史行不重播
  const playedStreamRows = useRef<Set<string>>(new Set());

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

  /**
   * 会话辅助（回顾 + 追问建议）贴在流末尾，而它是**本轮结束后由辅助模型异步回推**的：
   * 那时 items 长度早已固定，上面的跟底 effect 不会再触发，建议会静静落在可视区之外。
   * 故单独补一次：结果到达且用户仍在底部时贴底。切会话/首帧不参与（session 对不上即跳过）。
   */
  useLayoutEffect(() => {
    if (!assistSession || assistSession !== activeConversationId) return;
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [assistSession, assistForItemsLen, activeConversationId]);

  // T8.3：切换可见对话 → 恢复该对话自己的滚动位置，只有它记住「跟底」时才贴底
  useEffect(() => {
    renderedConvRef.current = activeConversationId;
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, followBottom, historyLoaded, streaming: convStreaming } = useSessionStore.getState().sliceOf(activeConversationId);
    // 历史尚未整读时 followBottom 是初始值（true 只因缺省，见 emptySlice）——不代表用户意愿。
    // 「跟底是真实状态」（本段会话里滚动过/正在流式/没有历史的空对话）才贴底；
    // 打开一条未读入的旧对话：先钉在顶部，等历史整读落地后由下面的 effect 一次性贴到最新。
    const hasRealScrollState = convStreaming || scrollTop > 0;
    const shouldFollow = followBottom && (hasRealScrollState || (historyLoaded && items.length === 0));
    atBottomRef.current = shouldFollow;
    setAtBottom(shouldFollow);
    const target = shouldFollow ? el.scrollHeight : scrollTop;
    el.scrollTop = target;
    // 虚拟列表首帧还没测完行高，下一帧按同一目标补一次
    const raf = requestAnimationFrame(() => {
      el.scrollTop = target;
    });
    return () => cancelAnimationFrame(raf);
  }, [activeConversationId]);

  // 首次打开一条有历史的对话：等整读对账落地后一次性贴到最新（无动画瞬时定位）。
  // 只补偿「打开时没被滚过」的场景；用户中途上翻（followBottom 被滚事件置否）不再抢。
  useLayoutEffect(() => {
    const s = useSessionStore.getState().sliceOf(activeConversationId);
    if (!s.historyLoaded || !s.followBottom || s.items.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = true;
    setAtBottom(true);
    el.scrollTop = el.scrollHeight;
    // 行高测量分两轮才稳定（图片/代码块首轮估计值偏差大），双帧补两次
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeConversationId, items, historyLoaded]);

  const empty = items.length === 0 && !liveText && !liveThinking && !streaming;
  const rows = virtualizer.getVirtualItems();

  // 空态由居中的 Onboarding Composer 承载问候与输入框，此处不占位
  if (empty) return null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-8 pt-6" aria-live="polite" role="log">
      {
        <div className="mx-auto w-full max-w-[var(--pk-chat-width,48rem)]">
          <div style={{ height: virtualizer.getTotalSize() }} className="relative w-full">
            {rows.map((row) => {
              const r = displayRows[row.index];
              const tight = r.kind === "tool" || r.kind === "thinking" || r.kind === "tool_group";
              // ZCode 输出流同步：流式期间新增的行首次出现即淡入（每卡 +36ms，封顶 240ms 错落），
              // 已播放过的行（滚动回挂/历史行）不重播。
              const rowKey = `${activeConversationId}:${r.id}`;
              const streamEnter = streaming && !playedStreamRows.current.has(rowKey);
              if (streamEnter) playedStreamRows.current.add(rowKey);
              return (
              <div
                key={row.key}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <div className={cn("rounded-lg", tight ? "mb-2" : "mb-4", r.id === flashId && "ring-1 ring-ring/50 transition-shadow")}>
                  <div
                    className={cn(streamEnter && "pk-stream-in")}
                    style={streamEnter ? ({ "--pk-stream-delay": `${Math.min(row.index * 36, 240)}ms` } as React.CSSProperties) : undefined}
                  >
                    <ConversationRow item={r} isLatest={r.id === latestAssistantId} />
                  </div>
                </div>
              </div>
              );
            })}
          </div>

          {/* live 尾块：流式思考 / 流式正文（不进虚拟列表，避免每 token 重排） */}
          {(liveThinking || liveText || streaming) && (
            <div className="pk-stream-in flex w-full flex-col gap-3 pb-2">
              {liveThinking && (
                <div className="pk-stream-in">
                  <ThinkingCard text={liveThinking} streaming preview={liveThinking.slice(-60)} defaultOpen={thinkingDefaultOpen} />
                </div>
              )}
              {liveText && (
                <div className="pk-stream-in">
                  <AssistantProse text={liveText} streaming />
                </div>
              )}
              {streaming && !liveText && !liveThinking && (
                <div className="pk-stream-in">
                  <span className="pk-shimmer-text pl-1 text-[13px] font-medium">正在思考…</span>
                </div>
              )}
            </div>
          )}
          {/* T7.9 会话辅助（回顾 + 追问建议）：贴在**最后一轮回复之后**，随对话流滚动，
              不再悬浮在输入框上方；下一轮开始 / 点掉某条建议 / ✕ 都会让它消失 */}
          <ConversationAssist className="pt-2" />
        </div>
      }
      {/* 流末尾与底部输入框之间留白：辅助块/最后一条消息不贴着 Composer */}
      <div className="h-12" />
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
