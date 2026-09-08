import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/time";
import { Archive, MoreHorizontal, Pencil, Pin, PinOff, Trash2, X } from "lucide-react";
import { Icon } from "../ui/Icon";
import { badgeFor, tabTitle } from "../../stores/conversation-badge";
import type { SessionMeta } from "../../stores/session-meta-store";
import type { ConversationRow } from "../../stores/conversations-store";
import type { ProjectRecord, SessionItem } from "./useSidebarProjects";

/** 树里的一条「活跃对话」行：注册表行 + 渲染层派生（标题/未读），纯呈现。 */
export interface ConversationTreeItem {
  row: ConversationRow;
  title: string;
  unread: boolean;
  isTree: boolean;
}

/** 对话行状态圆点（③④）：绿呼吸=进行中 · 黄呼吸=待审批 · 蓝静止=完成未读（查看后消失） */
export function ConversationDot({ badge }: { badge: ReturnType<typeof badgeFor> }): React.JSX.Element {
  const base = "size-1.5 shrink-0 rounded-full conversation-dot";
  switch (badge) {
    case "approval":
      return <span className={cn(base, "animate-pulse bg-amber-500")} aria-label="待审批" />;
    case "streaming":
    case "queued":
    case "spawning":
      return <span className={cn(base, "animate-pulse bg-success")} aria-label="任务进行中" />;
    case "unread":
      return <span className={cn(base, "bg-sky-500")} aria-label="有未读" />;
    case "resting":
      return <span className={cn(base, "bg-muted-foreground/40")} aria-label="已关停" />;
    default:
      return <span className={cn(base, "opacity-0")} aria-hidden="true" />;
  }
}

type Editing = { kind: "project" | "conversation" | "session"; file?: string } | null;

/** 「⋯」触发钮：悬停浮现，stopPropagation 防触发行点击 */
function RowMenu({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-5 shrink-0 rounded p-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          type="button"
          aria-label={label}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36 text-[13px]" onClick={(event) => event.stopPropagation()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuItem({
  icon,
  label,
  onSelect,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onSelect(): void;
  destructive?: boolean;
}): React.JSX.Element {
  return (
    <DropdownMenuItem
      variant={destructive ? "destructive" : "default"}
      onSelect={() => onSelect()}
      className="gap-2 text-[13px]"
    >
      {icon}
      {label}
    </DropdownMenuItem>
  );
}

/** 单个项目分组：项目行 + 对话列表（活跃对话）+ 历史会话 + 「已归档」组。纯呈现，操作经回调上行。 */
export function ProjectGroup({
  project,
  virtual = false,
  conversations,
  sessions,
  metaMap,
  isActiveProject,
  isExpanded,
  activeSessionFile,
  activeConversationId,
  pendingCloseConversationId,
  onToggle,
  onStartDraft,
  onSelectConversation,
  onRequestCloseConversation,
  onResolveClose,
  onDismissClose,
  onSelectSession,
  onProjectRename,
  onProjectRemove,
  onRenameConversation,
  onToggleConversationPin,
  onArchiveConversation,
  onRenameSession,
  onToggleSessionPin,
  onArchiveSession,
  onDeleteSession,
}: {
  project: ProjectRecord;
  /** 「最近」虚拟项目分组：无项目管理菜单（重命名/移除），图标用对话语义 */
  virtual?: boolean;
  conversations: ConversationTreeItem[];
  sessions: SessionItem[];
  metaMap: Record<string, SessionMeta>;
  isActiveProject: boolean;
  isExpanded: boolean;
  activeSessionFile?: string;
  activeConversationId?: string | null;
  pendingCloseConversationId?: string | null;
  onToggle(): void;
  onStartDraft(): void;
  onSelectConversation(row: ConversationRow): void;
  onRequestCloseConversation(row: ConversationRow): void;
  onResolveClose(mode: "suspend" | "abort"): void;
  onDismissClose(): void;
  onSelectSession(session: SessionItem): void;
  onProjectRename(name: string): void;
  onProjectRemove(): void;
  onRenameConversation(row: ConversationRow, alias: string): void;
  onToggleConversationPin(row: ConversationRow, pinned: boolean): void;
  onArchiveConversation(row: ConversationRow): void;
  onRenameSession(file: string, alias: string): void;
  onToggleSessionPin(file: string, pinned: boolean): void;
  onArchiveSession(file: string, archived: boolean): void;
  onDeleteSession(file: string): Promise<boolean>;
}): React.JSX.Element {
  const [editing, setEditing] = useState<Editing>(null);
  const [editValue, setEditValue] = useState("");
  const [pendingDeleteFile, setPendingDeleteFile] = useState<string | null>(null);
  const [pendingRemoveProject, setPendingRemoveProject] = useState(false);

  const commitEdit = (): void => {
    if (!editing) return;
    const name = editValue.trim();
    if (name) {
      if (editing.kind === "project") onProjectRename(name);
      else if (editing.file) onRenameSession(editing.file, name);
    }
    setEditing(null);
  };

  const beginEdit = (next: Exclude<Editing, null>, initial: string): void => {
    setEditValue(initial);
    setEditing(next);
  };

  const sessionTitle = (session: SessionItem): string =>
    metaMap[session.file]?.alias ?? session.name ?? session.firstMessage ?? "空会话";

  const renderSessionRow = (session: SessionItem): React.JSX.Element => {
    const meta = metaMap[session.file];
    const title = sessionTitle(session);
    if (editing?.kind === "session" && editing.file === session.file) {
      return (
        <div key={session.file} className="flex items-center px-1 py-0.5">
          <Input
            autoFocus
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            onBlur={commitEdit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitEdit();
              if (event.key === "Escape") setEditing(null);
            }}
            className="h-6 text-[13px]"
            aria-label="会话名称"
          />
        </div>
      );
    }
    return (
      <div key={session.file} className="group flex min-w-0 items-center gap-1 rounded-md pr-1 hover:bg-sidebar-accent/60">
        <button
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:text-sidebar-foreground"
          type="button"
          title={session.firstMessage || title}
          onClick={() => onSelectSession(session)}
        >
          {meta?.pinned && <Pin className="size-3 shrink-0 rotate-45 text-primary" aria-label="已置顶" />}
          <span className={cn("min-w-0 flex-1 truncate", activeSessionFile === session.file && "font-medium text-sidebar-foreground")}>
            {title}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground/70">{formatRelativeTime(session.modified)}</span>
        </button>
        <RowMenu label={`${title} 的操作`}>
          <MenuItem
            icon={<Pencil className="size-3.5" />}
            label="重命名"
            onSelect={() => beginEdit({ kind: "session", file: session.file }, meta?.alias ?? "")}
          />
          <MenuItem
            icon={meta?.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            label={meta?.pinned ? "取消置顶" : "置顶"}
            onSelect={() => onToggleSessionPin(session.file, !meta?.pinned)}
          />
          <MenuItem icon={<Archive className="size-3.5" />} label="归档" onSelect={() => onArchiveSession(session.file, true)} />
          <MenuItem icon={<Trash2 className="size-3.5" />} label="删除…" destructive onSelect={() => setPendingDeleteFile(session.file)} />
        </RowMenu>
      </div>
    );
  };

  return (
    <section className="flex flex-col gap-0.5">
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md",
          isActiveProject ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60",
        )}
      >
        {editing?.kind === "project" ? (
          <div className="flex min-w-0 flex-1 items-center px-2 py-1">
            <Input
              autoFocus
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              onBlur={commitEdit}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitEdit();
                if (event.key === "Escape") setEditing(null);
              }}
              className="h-6 text-[13px]"
              aria-label="项目名称"
            />
          </div>
        ) : (
          <button className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[13px]" type="button" onClick={onToggle}>
            <Icon name="chevronRight" className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
            <Icon name={virtual ? "message" : isExpanded ? "folderOpen" : "folder"} className="size-4 shrink-0 opacity-80" />
            <span className="min-w-0 truncate">{project.name}</span>
          </button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6 opacity-0 text-muted-foreground hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          type="button"
          title={`在 ${project.name} 中新建任务`}
          aria-label={`在 ${project.name} 中新建任务`}
          onClick={(event) => {
            event.stopPropagation();
            onStartDraft();
          }}
        >
          <Icon name="add" className="size-3.5" />
        </Button>
        {!virtual && (
          <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="mr-1 size-6 opacity-0 text-muted-foreground hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              type="button"
              aria-label={`${project.name} 的操作`}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36 text-[13px]">
            <MenuItem icon={<Pencil className="size-3.5" />} label="重命名项目" onSelect={() => beginEdit({ kind: "project" }, project.name)} />
            <MenuItem icon={<Trash2 className="size-3.5" />} label="移除项目…" destructive onSelect={() => setPendingRemoveProject(true)} />
          </DropdownMenuContent>
        </DropdownMenu>
        )}
      </div>

      {isExpanded && (
        <div className="ml-[15px] flex flex-col gap-0.5 border-l border-sidebar-border pl-1.5">
          {conversations.map((item) => {
            const badge = badgeFor(item.row.status, {
              pendingApprovals: item.row.pendingApprovals,
              inFlightPrompt: item.row.inFlightPrompt,
              unread: item.unread ? 1 : 0,
            });
            const active = item.row.id === activeConversationId;
            const meta = item.row.sessionFile ? metaMap[item.row.sessionFile] : undefined;
            return (
              <div
                key={item.row.id}
                className={cn(
                  "group flex min-w-0 items-center gap-1 rounded-md pr-1",
                  active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60",
                )}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:text-sidebar-foreground"
                  type="button"
                  data-conversation-id={item.row.id}
                  title={item.isTree ? `${item.title}\n工作树：${item.row.worktreePath}` : item.title}
                  onClick={() => onSelectConversation(item.row)}
                >
                  <ConversationDot badge={badge} />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {item.isTree && (
                    <span className="shrink-0 rounded-sm bg-primary/10 px-1 text-[9px] leading-4 text-primary" title={`独立工作树：${item.row.worktreePath}`}>
                      树
                    </span>
                  )}
                </button>
                <RowMenu label={`${item.title} 的操作`}>
                  <MenuItem
                    icon={<Pencil className="size-3.5" />}
                    label="重命名"
                    onSelect={() => {
                      if (!item.row.sessionFile) {
                        // 无会话文件（首轮消息未落盘）：回调内 toast 提示，不进编辑态
                        onRenameConversation(item.row, "");
                        return;
                      }
                      beginEdit({ kind: "conversation", file: item.row.sessionFile }, meta?.alias ?? "");
                    }}
                  />
                  {meta && (
                    <MenuItem
                      icon={meta.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                      label={meta.pinned ? "取消置顶" : "置顶"}
                      onSelect={() => onToggleConversationPin(item.row, !meta.pinned)}
                    />
                  )}
                  <MenuItem icon={<Archive className="size-3.5" />} label="归档并关闭" onSelect={() => onArchiveConversation(item.row)} />
                </RowMenu>
                <button
                  type="button"
                  aria-label={`关闭 ${item.title}`}
                  onClick={() => onRequestCloseConversation(item.row)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-white/10 hover:text-foreground group-hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}

          {sessions.map((session) => renderSessionRow(session))}

          {conversations.length === 0 && sessions.length === 0 && (
            <div className="px-2 py-1 text-[11px] text-muted-foreground/60">还没有会话</div>
          )}

          {/* 删除会话：内联确认（不可逆，明示 CLI 亦不可恢复） */}
          {pendingDeleteFile && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-foreground">
              <span className="min-w-0 shrink">永久删除该会话？CLI 亦无法恢复。</span>
              <button
                type="button"
                onClick={async () => {
                  const file = pendingDeleteFile;
                  setPendingDeleteFile(null);
                  if (file) await onDeleteSession(file);
                }}
                className="rounded bg-destructive/20 px-1.5 py-0.5 text-destructive hover:bg-destructive/30"
              >
                删除
              </button>
              <button type="button" aria-label="取消" onClick={() => setPendingDeleteFile(null)} className="rounded p-0.5 hover:bg-white/10">
                <X className="size-3" />
              </button>
            </div>
          )}

          {/* 移除项目：内联确认（明示只解除关联） */}
          {pendingRemoveProject && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-foreground">
              <span className="min-w-0 shrink">移除该项目？磁盘代码与会话均不会删除。</span>
              <button
                type="button"
                onClick={() => {
                  setPendingRemoveProject(false);
                  onProjectRemove();
                }}
                className="rounded bg-destructive/20 px-1.5 py-0.5 text-destructive hover:bg-destructive/30"
              >
                移除
              </button>
              <button type="button" aria-label="取消" onClick={() => setPendingRemoveProject(false)} className="rounded p-0.5 hover:bg-white/10">
                <X className="size-3" />
              </button>
            </div>
          )}

          {/* 关闭在跑任务的对话：内联二选一（贴项目树行，不弹全局模态） */}
          {pendingCloseConversationId && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-foreground">
              <span className="shrink-0">该对话有任务在跑：</span>
              <button
                type="button"
                onClick={() => onResolveClose("suspend")}
                className="rounded bg-primary/15 px-1.5 py-0.5 hover:bg-primary/25"
              >
                关停引擎但保留可恢复
              </button>
              <button
                type="button"
                onClick={() => onResolveClose("abort")}
                className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive hover:bg-destructive/25"
              >
                中止任务并关闭
              </button>
              <button type="button" aria-label="取消" onClick={onDismissClose} className="rounded p-0.5 hover:bg-white/10">
                <X className="size-3" />
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** 树行标题（tabTitle 同源兜底），供 hook 组装 ConversationTreeItem 用 */
export function conversationTreeTitle(firstUserMessage: string | undefined, row: ConversationRow): string {
  return tabTitle(firstUserMessage, row.projectDir, row.id);
}
