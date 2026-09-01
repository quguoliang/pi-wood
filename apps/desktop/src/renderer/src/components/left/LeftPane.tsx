import { Button } from "@/components/ui/button";
import { Icon } from "../ui/Icon";
import { ProjectGroup } from "./ProjectGroup";
import { SidebarNav } from "./SidebarNav";
import { useSidebarProjects } from "./useSidebarProjects";

/**
 * 左栏（UI v3，参考 ZCode 侧栏）：顶部导航 + 项目分组树 + 底部设置。
 * 数据与交互全部在 useSidebarProjects，本组件只做组合呈现。
 */
export function LeftPane({ onOpenSettings }: { onOpenSettings: () => void }): React.JSX.Element {
  const {
    projects,
    sessionsByProject,
    expandedProjects,
    activeProject,
    activeSessionFile,
    toggleProject,
    createSession,
    selectSession,
    addProject,
  } = useSidebarProjects();

  return (
    <aside className="flex h-full min-h-0 flex-col bg-surface-chrome text-sidebar-foreground" aria-label="项目与会话">
      <SidebarNav
        onNewTask={() => window.dispatchEvent(new Event("piwood:new-session"))}
        onSearch={() => window.dispatchEvent(new Event("piwood:open-command-palette"))}
        onMarketplace={() => window.dispatchEvent(new Event("piwood:open-marketplace"))}
      />

      <section className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between px-4 pb-1 pt-1">
          <span className="text-xs font-medium text-muted-foreground">项目</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => void addProject()}
          >
            <Icon name="add" className="size-3.5" /> 添加
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
          {projects.map((project) => (
            <ProjectGroup
              key={project.path}
              project={project}
              sessions={sessionsByProject[project.path] ?? []}
              isActiveProject={activeProject === project.path}
              isExpanded={expandedProjects.has(project.path)}
              activeSessionFile={activeSessionFile}
              onToggle={() => toggleProject(project)}
              onCreateSession={() => void createSession(project)}
              onSelectSession={(session) => void selectSession(project, session)}
            />
          ))}
          {projects.length === 0 && (
            <p className="px-3 py-2 text-xs leading-relaxed text-muted-foreground/70">
              还没有项目，点击「添加」选择本地目录开始。
            </p>
          )}
        </div>
      </section>

      <footer className="shrink-0 p-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-start gap-2.5 rounded-md px-2.5 text-[13px] font-normal text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
          onClick={onOpenSettings}
        >
          <Icon name="settings" /> 设置
        </Button>
      </footer>
    </aside>
  );
}
