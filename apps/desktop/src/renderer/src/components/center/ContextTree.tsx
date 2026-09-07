import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Icon } from "../ui/Icon";
import { useActiveConversation, useSessionStore } from "../../stores/session-store";
import { useConversationsStore } from "../../stores/conversations-store";
import { useContextTreeStore } from "../../stores/context-tree-store";
import { useSettingsStore } from "../../stores/settings-store";
import { groupToolRows } from "../../lib/tool-groups";
import { buildContextOutline, type OutlineEntry, type OutlineToolStatus } from "../../lib/context-outline";
import { deriveContextTree, expandBranch, navigateLandsOn, type BranchNode } from "../../lib/context-tree";

/**
 * T9.1 上下文缩略树 v1（对话大纲）+ T9.2 v2（真分支叠加层）：中栏左缘竖栏。
 * v1 底座不变：节点=用户轮（序号圆点+首行摘要）+ 该轮工具子行，单击跳转、scroll spy 高亮。
 * v2 叠加（数据源 = sessions:tree 的 Pi 会话条目树）：
 * - 被放弃/未选择的旁支以虚线分支行挂在分叉点之下（折叠一行，可展开看该支内的每一问）；
 * - **双击**旁支 = engine:navigateTree 切 leaf（同文件内、不截断）→ 历史按路径重过滤（换底）
 *   → 若目标是用户消息，原文回填输入框（「改这问重发」，与 SDK 语义一致）；
 * - 手选过旧分支时底部给「回到最新」条。
 * 显隐由 settings.ui.contextTreeEnabled 控制（ConversationHeader 按钮）；空对话不渲染。
 */

function StatusDot({ status }: { status: OutlineToolStatus }): React.JSX.Element {
  if (status === "running") return <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-warning" aria-label="进行中" />;
  if (status === "error") return <span className="size-1.5 shrink-0 rounded-full bg-destructive/80" aria-label="出错" />;
  return <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" aria-label="完成" />;
}

const fmtWhen = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function ContextTree(): React.JSX.Element | null {
  const toolGroupsEnabled = useSettingsStore((s) => s.settings.ui.toolGroupsEnabled);
  const activeConversationId = useSessionStore((s) => s.activeConversationId);
  const items = useActiveConversation((c) => c.items);
  const streaming = useActiveConversation((c) => c.streaming);
  const sessionFile = useConversationsStore((s) => s.rows.find((r) => r.id === activeConversationId)?.sessionFile);
  const treeEntry = useContextTreeStore((s) => (activeConversationId ? s.byConv[activeConversationId] : undefined));
  const refreshTree = useContextTreeStore((s) => s.refresh);

  const rows = useMemo(() => groupToolRows(items, toolGroupsEnabled), [items, toolGroupsEnabled]);
  const outline = useMemo(() => buildContextOutline(rows, { streaming }), [rows, streaming]);
  const userCount = useMemo(() => outline.filter((e) => e.kind === "user").length, [outline]);

  // T9.2：树数据刷新（低频）——切对话/会话文件变化刷一次，一轮 settled 再强刷一次。
  // 不在流式中刷：行内导航由 v1 大纲从 DisplayRow 派生，树只负责旁支结构，无需逐 token 新鲜。
  useEffect(() => {
    if (activeConversationId && sessionFile) void refreshTree(activeConversationId, sessionFile);
  }, [activeConversationId, sessionFile, refreshTree]);
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !streaming && activeConversationId && sessionFile) {
      void refreshTree(activeConversationId, sessionFile, { force: true });
    }
    wasStreaming.current = streaming;
  }, [streaming, activeConversationId, sessionFile, refreshTree]);

  const tree = useMemo(() => deriveContextTree(treeEntry?.rows ?? [], treeEntry?.leafId), [treeEntry]);
  // 旁支按挂载序号分组；超出路径 user 数的（罕见竞态）并入最后一组
  const branchesByOrdinal = useMemo(() => {
    const map = new Map<number, BranchNode[]>();
    const maxNo = Math.max(userCount, 1);
    for (const b of tree.branches) {
      const k = Math.min(Math.max(b.attachOrdinal, 0), maxNo);
      const list = map.get(k);
      if (list) list.push(b);
      else map.set(k, [b]);
    }
    return map;
  }, [tree.branches, userCount]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedBranch, setExpandedBranch] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | undefined>();
  const [switching, setSwitching] = useState(false);

  // scroll spy 高亮（MessageList 派发）；会话切换时重置展开与高亮
  useEffect(() => {
    setActiveId(undefined);
    setExpanded(new Set());
    setExpandedBranch(new Set());
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
  const toggleBranch = (id: string): void => {
    setExpandedBranch((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 双击旁支 = navigateTree 切 leaf + 历史换底 + （user 目标）原文回填输入框 */
  const switchBranch = useCallback(
    async (entryId: string): Promise<void> => {
      if (!activeConversationId || streaming || switching) return;
      const treeRows = treeEntry?.rows ?? [];
      const land = navigateLandsOn(treeRows, entryId);
      if (!land) return;
      if (land.leafId === null) {
        toast.info("该条目位于会话最开头，切到它之前等于重开对话——点项目里的「+」新起一条更干净");
        return;
      }
      setSwitching(true);
      try {
        const res = await window.pi.engineNavigateTree(activeConversationId, entryId);
        if (res.cancelled) {
          toast.info("分支切换被扩展取消");
          return;
        }
        useContextTreeStore.getState().setLeaf(activeConversationId, land.leafId);
        await useSessionStore.getState().rebaseToBranch(activeConversationId);
        if (land.prefill && res.editorText) {
          window.dispatchEvent(new CustomEvent("piwood:composer-insert", { detail: { text: res.editorText, replace: true } }));
          toast.success("已切到这条分支：原提问已放回输入框，改完重发即可从这里续写");
        } else {
          toast.success("已切到这条分支，后续回复从这里继续");
        }
      } catch (err) {
        toast.error(`切换分支失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setSwitching(false);
      }
    },
    [activeConversationId, streaming, switching, treeEntry?.rows],
  );

  const backToLatest = useCallback((): void => {
    if (!activeConversationId) return;
    useContextTreeStore.getState().setLeaf(activeConversationId, null);
    void useSessionStore.getState().rebaseToBranch(activeConversationId);
  }, [activeConversationId]);

  if (items.length === 0) return null; // 空对话：Onboarding 空态本身无消息列表，树栏不渲染

  const tooFew = userCount < 2 && !streaming && tree.branches.length === 0;
  const switchDisabledTip = streaming ? "等本轮回答结束后再切换分支" : switching ? "上一次切换还没完成" : undefined;

  const renderBranches = (ordinal: number): React.JSX.Element | null => {
    const list = branchesByOrdinal.get(ordinal);
    if (!list?.length) return null;
    return (
      <div key={`branches-${ordinal}`}>
        {list.map((b) => {
          const open = expandedBranch.has(b.rootId);
          const kids = open ? expandBranch(treeEntry?.rows ?? [], b.rootId) : [];
          return (
            <div key={b.rootId} className="ml-[11px] border-l border-dashed border-foreground/15 pl-2">
              <button
                type="button"
                onClick={() => b.userCount > 0 && toggleBranch(b.rootId)}
                onDoubleClick={() => void switchBranch(b.rootId)}
                disabled={switching}
                title={
                  switchDisabledTip ??
                  `放弃的分支（${fmtWhen(b.timestamp)}）：${b.title}\n双击把对话切到这条分支${b.userCount > 0 ? "，单击展开看分支里的每一问" : ""}`
                }
                className={cn(
                  "group/branch flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[11px] text-muted-foreground/75 transition-colors hover:bg-sidebar-accent/60 hover:text-foreground",
                  (switching || streaming) && "cursor-not-allowed opacity-50",
                )}
              >
                <Icon name="gitBranch" className="size-3 shrink-0 opacity-60" />
                <span className="min-w-0 flex-1 truncate italic">{b.title}</span>
                {b.userCount > 1 && <span className="shrink-0 rounded-full bg-muted px-1 text-[10px] tabular-nums">{b.userCount} 轮</span>}
                {b.userCount > 0 && <Icon name="chevronRight" className={cn("size-3 shrink-0 opacity-50 transition-transform", open && "rotate-90")} />}
                {!switchDisabledTip && b.userCount >= 0 && (
                  <span className="hidden shrink-0 items-center gap-0.5 text-[10px] text-primary group-hover/branch:flex">
                    <Icon name="arrowRight" className="size-3" />
                    切到这
                  </span>
                )}
              </button>
              {open && kids.length > 0 && (
                <div className="ml-[7px] animate-in border-l border-dashed border-foreground/10 pl-1.5 [animation-fill-mode:both] fade-in-0 slide-in-from-left-1 duration-150">
                  {kids.map((k) => (
                    <button
                      key={k.entryId}
                      type="button"
                      onDoubleClick={() => void switchBranch(k.entryId)}
                      disabled={switching}
                      title={switchDisabledTip ?? `双击把对话切到「${k.title}」`}
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[11px] text-muted-foreground/70 transition-colors hover:bg-sidebar-accent/60 hover:text-foreground",
                        (switching || streaming) && "cursor-not-allowed opacity-50",
                      )}
                      style={{ marginLeft: Math.min(k.hops, 4) * 4 }}
                    >
                      <span className="size-1 shrink-0 rounded-full bg-muted-foreground/30" />
                      <span className="min-w-0 flex-1 truncate">{k.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <aside
      aria-label="上下文缩略树"
      className="flex w-56 shrink-0 animate-in flex-col border-r border-border/60 [animation-fill-mode:both] fade-in-0 slide-in-from-left-2 duration-150"
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/60 px-3 text-[11px] font-medium tracking-wide text-muted-foreground">
        上下文
        {userCount > 0 && <span className="tabular-nums text-muted-foreground/60">{userCount}</span>}
        {tree.branches.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] tabular-nums" title="存在被放弃的分支，双击分支行可切过去">
            <Icon name="gitBranch" className="size-3" />
            {tree.branches.length}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {tooFew ? (
          <p className="px-2 py-3 text-[11px] leading-5 text-muted-foreground">继续对话以生成大纲——每个任务与工具调用都会成为树上的一个节点。</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {renderBranches(0)}
            {outline.map((entry) => (
              <div key={entry.id}>
                <OutlineRow
                  entry={entry}
                  activeId={activeId}
                  expanded={expanded}
                  onJump={jump}
                  onToggle={toggleExpand}
                />
                {entry.kind === "user" && entry.no != null && renderBranches(entry.no)}
              </div>
            ))}
          </div>
        )}
      </div>
      {treeEntry?.manuallySwitched && (
        <button
          type="button"
          onClick={backToLatest}
          className="mx-1.5 mb-1.5 flex shrink-0 items-center gap-1.5 rounded-md border border-dashed border-border/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
          title="对话当前挂在这条历史分支上；点一下回到最新进展"
        >
          <Icon name="arrowRight" className="size-3" />
          正在查看历史分支 · 回到最新
        </button>
      )}
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
