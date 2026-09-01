import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/time";
import { Icon } from "../ui/Icon";
import type { ProjectRecord, SessionItem } from "./useSidebarProjects";

/** 单个项目分组：项目行（激活+展开）+ 缩进会话列表（标题 + 相对时间）。纯呈现。 */
export function ProjectGroup({
  project,
  sessions,
  isActiveProject,
  isExpanded,
  activeSessionFile,
  onToggle,
  onCreateSession,
  onSelectSession,
}: {
  project: ProjectRecord;
  sessions: SessionItem[];
  isActiveProject: boolean;
  isExpanded: boolean;
  activeSessionFile?: string;
  onToggle(): void;
  onCreateSession(): void;
  onSelectSession(session: SessionItem): void;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-0.5">
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md",
          isActiveProject ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60",
        )}
      >
        <button className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[13px]" type="button" onClick={onToggle}>
          <Icon name="chevronRight" className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
          <Icon name={isExpanded ? "folderOpen" : "folder"} className="size-4 shrink-0 opacity-80" />
          <span className="min-w-0 truncate">{project.name}</span>
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="mr-1 size-6 opacity-0 text-muted-foreground hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          type="button"
          title={`在 ${project.name} 中新建会话`}
          aria-label={`在 ${project.name} 中新建会话`}
          onClick={(event) => {
            event.stopPropagation();
            onCreateSession();
          }}
        >
          <Icon name="add" className="size-3.5" />
        </Button>
      </div>

      {isExpanded && (
        <div className="ml-[15px] flex flex-col gap-0.5 border-l border-sidebar-border pl-1.5">
          {sessions.map((session) => (
            <button
              className={cn(
                "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                activeSessionFile === session.file && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
              )}
              key={session.file}
              type="button"
              title={session.firstMessage || "空会话"}
              onClick={() => onSelectSession(session)}
            >
              <span className="min-w-0 flex-1 truncate">{session.firstMessage || "空会话"}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground/70">{formatRelativeTime(session.modified)}</span>
            </button>
          ))}
          {sessions.length === 0 && <div className="px-2 py-1 text-[11px] text-muted-foreground/60">还没有会话</div>}
        </div>
      )}
    </section>
  );
}
