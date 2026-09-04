import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionStore } from "../../stores/session-store";
import { badgeFor, tabTitle, type ConversationStatus } from "../../stores/conversation-badge";
import { toast } from "sonner";

/**
 * T8.8 对话标签条（ConversationHeader 同排，步骤 1/2/3）：
 * - 每标签：标题（首条用户消息，与会话列表同源）+ 状态指示（转圈/红点/蓝点/灰/虚线）+ 树角标 + 关闭按钮
 * - 「+」：同项目再开一条（T8.6 起各带独立 worktree；选项目/fork 高级形态后续迭代）
 * - 关闭在跑任务的对话 → 内联二选一（关停引擎但保留可恢复=suspend / 中止任务=abort+close），绝不静默 abort
 * - 快捷键（App 注册）：Ctrl+Shift+[ / ] 切对话、Ctrl+Shift+N 新建、Ctrl+W 关闭当前
 */
interface ConvRow {
  id: string;
  status: ConversationStatus;
  projectDir: string;
  inFlightPrompt: boolean;
  pendingApprovals: number;
  worktreePath?: string;
}

interface PendingClose {
  conversationId: string;
  busy: boolean;
}

export function ConversationTabs(): React.JSX.Element | null {
  const [rows, setRows] = useState<ConvRow[]>([]);
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const activeId = useSessionStore((s) => s.activeConversationId);
  const activeProject = useSessionStore((s) => s.activeProject);
  const slices = useSessionStore((s) => s.slices);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const r = (await window.pi.listConversations?.()) as { conversations?: ConvRow[] } | undefined;
      if (r?.conversations) setRows(r.conversations);
    } catch {
      /* 引擎未起时静默（标签条只在有对话时渲染） */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => clearInterval(timer);
  }, [refresh, activeId]);

  const switchTo = (id: string): void => {
    useSessionStore.getState().setActiveConversation(id);
  };

  const closeConversation = async (row: ConvRow): Promise<void> => {
    const busy = row.status === "streaming" || row.inFlightPrompt || row.pendingApprovals > 0;
    if (busy) {
      setPendingClose({ conversationId: row.id, busy });
      return;
    }
    await window.pi.closeConversation?.(row.id);
    toast("对话已关闭");
    void refresh();
  };

  const resolvePendingClose = async (mode: "suspend" | "abort"): Promise<void> => {
    const p = pendingClose;
    setPendingClose(null);
    if (!p) return;
    if (mode === "suspend") {
      // 关停引擎但保留可恢复：suspend 只优雅退出 child，sessionFile 保留，切回/再开自动接回上下文
      await window.pi.suspendConversation?.(p.conversationId);
      toast("引擎已关停，上下文保留（切回该对话自动恢复）");
    } else {
      // 中止任务：先 abort 当前轮再 close（worktree 未回流改动会保留并提示）
      try {
        await window.pi.engineAbort();
      } catch {
        /* 已在收尾的引擎 abort 可能失败，忽略 */
      }
      await window.pi.closeConversation?.(p.conversationId);
      toast("任务已中止，对话已关闭", { description: "工作树未回流改动已保留，可稍后手工处理" });
    }
    void refresh();
  };

  const createConversation = async (): Promise<void> => {
    if (!activeProject) return;
    try {
      const r = (await window.pi.createConversation?.(activeProject)) as { conversationId?: string } | undefined;
      if (r?.conversationId) switchTo(r.conversationId);
      void refresh();
    } catch (err) {
      toast(`新建对话失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 键盘可达（步骤 2，对齐 §11）：Ctrl/Cmd+Shift+[ / ] 循环切对话、Ctrl/Cmd+Shift+N 新建、Ctrl/Cmd+W 关闭当前
  const stateRef = useRef({ rows, activeId, activeProject });
  stateRef.current = { rows, activeId, activeProject };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = (e.ctrlKey || e.metaKey) && e.shiftKey;
      if (!mod) return;
      const key = e.key;
      const { rows: rs, activeId: aid, activeProject: proj } = stateRef.current;
      if (key === "[") {
        e.preventDefault();
        if (rs.length === 0) return;
        const idx = rs.findIndex((r) => r.id === aid);
        switchTo(rs[(idx - 1 + rs.length) % rs.length]!.id);
      } else if (key === "]") {
        e.preventDefault();
        if (rs.length === 0) return;
        const idx = rs.findIndex((r) => r.id === aid);
        switchTo(rs[(idx + 1) % rs.length]!.id);
      } else if (key.toLowerCase() === "n") {
        e.preventDefault();
        void createConversation();
      } else if (key.toLowerCase() === "w") {
        e.preventDefault();
        if (!proj) return;
        const cur = rs.find((r) => r.id === aid);
        if (cur) void closeConversation(cur);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (rows.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1" role="tablist" aria-label="对话标签条">
      {rows.map((row) => {
        const badge = badgeFor(row.status, {
          pendingApprovals: row.pendingApprovals,
          inFlightPrompt: row.inFlightPrompt,
          unread: slices[row.id]?.unreadCount ?? 0,
        });
        const firstUser = slices[row.id]?.items.find((i) => i.kind === "user");
        const title = tabTitle(firstUser && firstUser.kind === "user" ? firstUser.text : undefined, row.projectDir, row.id);
        const isTree = Boolean(row.worktreePath) && row.worktreePath !== row.projectDir;
        const active = row.id === activeId;
        return (
          <div
            key={row.id}
            role="tab"
            aria-selected={active}
            title={
              isTree
                ? `${title}\n工作树：${row.worktreePath}`
                : title
            }
            className={cn(
              "group flex max-w-[180px] shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors",
              active
                ? "border-border bg-muted/70 text-foreground"
                : "border-transparent text-muted-foreground hover:border-border/60 hover:bg-muted/40",
            )}
          >
            <button type="button" onClick={() => switchTo(row.id)} className="flex min-w-0 items-center gap-1.5">
              <TabDot badge={badge} />
              <span className="truncate">{title}</span>
              {isTree && (
                <span
                  className="shrink-0 rounded-sm bg-primary/10 px-1 text-[9px] leading-4 text-primary"
                  title={`独立工作树：${row.worktreePath}`}
                >
                  树
                </span>
              )}
            </button>
            <button
              type="button"
              aria-label={`关闭 ${title}`}
              onClick={() => void closeConversation(row)}
              className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-white/10 group-hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => void createConversation()}
        aria-label="新建对话"
        title={`同项目再开一条对话（${activeProject?.split(/[\\/]/).pop() ?? ""}，各带独立工作树）`}
        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
      >
        <Plus className="size-3.5" />
      </button>

      {/* 关闭在跑任务的对话：内联二选一（贴标签条，不弹全局模态） */}
      {pendingClose && (
        <div className="ml-2 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-foreground">
          <span className="shrink-0">该对话有任务在跑：</span>
          <button
            type="button"
            onClick={() => void resolvePendingClose("suspend")}
            className="rounded bg-primary/15 px-1.5 py-0.5 hover:bg-primary/25"
          >
            关停引擎但保留可恢复
          </button>
          <button
            type="button"
            onClick={() => void resolvePendingClose("abort")}
            className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive hover:bg-destructive/25"
          >
            中止任务并关闭
          </button>
          <button type="button" aria-label="取消" onClick={() => setPendingClose(null)} className="rounded p-0.5 hover:bg-white/10">
            <X className="size-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function TabDot({ badge }: { badge: string }): React.JSX.Element {
  if (badge === "approval") return <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-label="待审批" />;
  if (badge === "streaming") return <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-label="任务在跑" />;
  if (badge === "queued") return <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground" aria-label="排队中" />;
  if (badge === "spawning") return <span className="size-1.5 shrink-0 animate-pulse rounded-full border border-dashed border-primary" aria-label="引擎启动中" />;
  if (badge === "resting") return <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" aria-label="已关停" />;
  if (badge === "unread") return <span className="size-1.5 shrink-0 rounded-full bg-sky-500" aria-label="有未读" />;
  return <span className="size-1.5 shrink-0" />;
}
