import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Icon } from "../ui/Icon";
import { ProjectGroup } from "./ProjectGroup";
import { SidebarNav } from "./SidebarNav";
import { useSidebarProjects } from "./useSidebarProjects";

/**
 * 左栏（UI v3，参考 ZCode 侧栏）：顶部导航 + 项目分组树 + 底部设置。
 * 数据与交互全部在 useSidebarProjects，本组件只做组合呈现。
 * 对话导航唯一入口：活跃对话（带状态圆点）归组在项目下，历史会话跟随其后。
 */
export function LeftPane({ onOpenSettings }: { onOpenSettings: () => void }): React.JSX.Element {
  const {
    projects,
    virtualProject,
    treeRowsByProject,
    metaMap,
    expandedProjects,
    activeProject,
    activeSessionFile,
    activeConversationId,
    pendingCloseConversationId,
    toggleProject,
    startDraftIn,
    selectConversation,
    requestCloseConversation,
    resolvePendingClose,
    dismissPendingClose,
    selectSession,
    addProject,
    removeProject,
    renameProject,
    archiveConversation,
    renameConversation,
    renameSession,
    setSessionPinned,
    setSessionArchived,
    deleteSession,
  } = useSidebarProjects();

  return (
    <aside className="flex h-full min-h-0 flex-col bg-surface-chrome text-sidebar-foreground" aria-label="项目与会话">
      {/* 双平台无全宽顶栏：本栏顶部 40px 为自定义拖拽栏——macOS 放红绿灯，Windows 仅有栏开关；
          开关作为 no-drag 子元素嵌在拖拽区内（Electron 可靠模式），中心线对齐卡片 header（y≈26） */}
      <div className="app-drag relative h-10 shrink-0">
        {window.pi.platform === "darwin" && (
          /* 自绘红绿灯悬浮在本栏上方（AppShell z-30）：拖拽区会吞非后代元素的点击，
              在灯占位（x 26-82）打 no-drag 洞后点击才能落到灯上 */
          <span aria-hidden="true" className="app-no-drag pointer-events-none absolute inset-y-0 left-[18px] w-[72px]" />
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(
            "app-no-drag absolute top-[10px] text-muted-foreground hover:text-foreground active:scale-100!",
            window.pi.platform === "win32" ? "left-2" : "left-[92px]",
          )}
          onClick={() => window.dispatchEvent(new Event("piwood:toggle-sidebar"))}
          aria-label="展开或收起项目栏"
        >
          <Icon name="sidebar" size={15} />
        </Button>
      </div>
      <SidebarNav
        onNewTask={() => window.dispatchEvent(new Event("piwood:new-session"))}
        onSearch={() => window.dispatchEvent(new Event("piwood:open-command-palette"))}
        onMarketplace={() => window.dispatchEvent(new Event("piwood:open-marketplace"))}
      />

      <section className="flex min-h-0 flex-1 flex-col">
        <header className="group/head flex shrink-0 items-center justify-between px-4 pb-1 pt-1">
          <span className="text-caption font-medium tracking-wider text-ink-muted">项目</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/head:opacity-100"
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
              rows={treeRowsByProject[project.path] ?? []}
              metaMap={metaMap}
              isActiveProject={activeProject === project.path}
              isExpanded={expandedProjects.has(project.path)}
              activeSessionFile={activeSessionFile}
              activeConversationId={activeConversationId}
              pendingCloseConversationId={pendingCloseConversationId}
              onToggle={() => toggleProject(project)}
              onStartDraft={() => void startDraftIn(project)}
              onSelectConversation={selectConversation}
              onRequestCloseConversation={requestCloseConversation}
              onResolveClose={(mode) => void resolvePendingClose(mode)}
              onDismissClose={dismissPendingClose}
              onSelectSession={(session) => void selectSession(project, session)}
              onProjectRename={(name) => void renameProject(project, name)}
              onProjectRemove={() => void removeProject(project)}
              onRenameConversation={(row, alias) => renameConversation(row, alias)}
              onToggleConversationPin={(row, pinned) => row.sessionFile && setSessionPinned(row.sessionFile, pinned)}
              onArchiveConversation={(row) => void archiveConversation(row)}
              onRenameSession={renameSession}
              onToggleSessionPin={setSessionPinned}
              onArchiveSession={setSessionArchived}
              onDeleteSession={deleteSession}
            />
          ))}
          {projects.length === 0 && (
            <p className="px-3 py-2 text-xs leading-relaxed text-muted-foreground/70">
              还没有项目，点击「添加」选择本地目录开始。
            </p>
          )}
          {virtualProject && (
            /* 「最近」大分组：普通对话（无项目）的归属，最新对话在最前；无项目管理菜单 */
            <ProjectGroup
              virtual
              project={virtualProject}
              rows={treeRowsByProject[virtualProject.path] ?? []}
              metaMap={metaMap}
              isActiveProject={activeProject === virtualProject.path}
              isExpanded={expandedProjects.has(virtualProject.path)}
              activeSessionFile={activeSessionFile}
              activeConversationId={activeConversationId}
              pendingCloseConversationId={pendingCloseConversationId}
              onToggle={() => toggleProject(virtualProject)}
              onStartDraft={() => void startDraftIn(virtualProject)}
              onSelectConversation={selectConversation}
              onRequestCloseConversation={requestCloseConversation}
              onResolveClose={(mode) => void resolvePendingClose(mode)}
              onDismissClose={dismissPendingClose}
              onSelectSession={(session) => void selectSession(virtualProject, session)}
              onProjectRename={() => undefined}
              onProjectRemove={() => undefined}
              onRenameConversation={(row, alias) => renameConversation(row, alias)}
              onToggleConversationPin={(row, pinned) => row.sessionFile && setSessionPinned(row.sessionFile, pinned)}
              onArchiveConversation={(row) => void archiveConversation(row)}
              onRenameSession={renameSession}
              onToggleSessionPin={setSessionPinned}
              onArchiveSession={setSessionArchived}
              onDeleteSession={deleteSession}
            />
          )}
        </div>
      </section>

      <footer className="flex shrink-0 items-center justify-between gap-2 p-2 pt-1">
        <div className="flex min-w-0 items-center gap-2 pl-1" aria-label="pi-wood">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-avatar text-[12px] font-bold text-white">π</span>
          <span className="truncate text-[13px] font-semibold tracking-tight">pi-wood</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 gap-2 rounded-md px-2.5 text-[13px] font-normal text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
          onClick={onOpenSettings}
        >
          <Icon name="settings" /> 设置
        </Button>
      </footer>
    </aside>
  );
}
