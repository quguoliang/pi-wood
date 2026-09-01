import { lazy, Suspense, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "../ui/Icon";
import { useWorkbenchStore, type WorkbenchTab } from "../../stores/workbench-store";

const FilesPanel = lazy(() => import("./FilesPanel").then((module) => ({ default: module.FilesPanel })));
const TerminalPanel = lazy(() => import("./TerminalPanel").then((module) => ({ default: module.TerminalPanel })));
const BrowserPanel = lazy(() => import("./BrowserPanel").then((module) => ({ default: module.BrowserPanel })));
const DiffPanel = lazy(() => import("./DiffPanel").then((module) => ({ default: module.DiffPanel })));

interface PanelMeta {
  title: string;
  icon: IconName;
  kbd: string;
}

/** 基础面板元数据。启动器与「+」菜单按此顺序展示（对齐参考图：审查 / 终端 / 浏览器 / 文件）。 */
const panelMeta: Record<WorkbenchTab, PanelMeta> = {
  diff: { title: "审查", icon: "listChecks", kbd: "Ctrl+Shift+G" },
  term: { title: "终端", icon: "terminal", kbd: "Ctrl+`" },
  browser: { title: "浏览器", icon: "browser", kbd: "Ctrl+T" },
  files: { title: "文件", icon: "folder", kbd: "Ctrl+P" },
};
const LAUNCH_ORDER: WorkbenchTab[] = ["diff", "term", "browser", "files"];

function panelNode(tab: WorkbenchTab): React.ReactNode {
  switch (tab) {
    case "files": return <FilesPanel />;
    case "term": return <TerminalPanel />;
    case "browser": return <BrowserPanel />;
    case "diff": return <DiffPanel />;
  }
}

function LoadingPanel(): React.JSX.Element {
  return <div className="grid h-full place-items-center p-4 text-center text-xs text-muted-foreground">正在载入面板…</div>;
}

/** 收起右侧栏（就近放在面板头部最右）。 */
function ClosePaneButton(): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="self-center text-muted-foreground hover:text-foreground"
      onClick={() => window.dispatchEvent(new Event("piwood:toggle-inspector"))}
      aria-label="收起右侧工作台"
    >
      <Icon name="panelRight" />
    </Button>
  );
}

/** 「+」新增面板菜单：列出全部基础面板，点击即打开（已开则激活）。 */
function AddTabMenu({ onPick }: { onPick(tab: WorkbenchTab): void }): React.JSX.Element {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="self-center text-muted-foreground hover:text-foreground" aria-label="新增面板">
          <Icon name="add" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-56 gap-0.5 p-1.5">
        {LAUNCH_ORDER.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onPick(tab)}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent"
          >
            <Icon name={panelMeta[tab].icon} className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{panelMeta[tab].title}</span>
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{panelMeta[tab].kbd}</kbd>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Chrome 式单枚标签：图标 + 标题 + 关闭 ×（激活常显、其余悬停显）。 */
function TabButton({
  tab,
  active,
  onActivate,
  onClose,
}: {
  tab: WorkbenchTab;
  active: boolean;
  onActivate(): void;
  onClose(): void;
}): React.JSX.Element {
  const meta = panelMeta[tab];
  return (
    <div
      className={cn(
        "group flex max-w-45 items-center gap-1 rounded-md pl-2.5 pr-1 text-xs transition-colors",
        active ? "bg-surface-app text-foreground" : "text-muted-foreground hover:bg-white/5",
      )}
    >
      <button type="button" onClick={onActivate} className="flex min-w-0 items-center gap-1.5 py-1.5">
        <Icon name={meta.icon} className="size-3.5 shrink-0" />
        <span className="truncate">{meta.title}</span>
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={`关闭${meta.title}`}
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded text-muted-foreground transition-opacity hover:bg-foreground/10 hover:text-foreground",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <Icon name="x" className="size-3" />
      </button>
    </div>
  );
}

/** 空态启动器（图一）：居中列出基础功能，点击创建对应面板。 */
function Launcher({ onPick }: { onPick(tab: WorkbenchTab): void }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center px-5">
      <div className="flex w-full max-w-72 flex-col gap-1.5">
        {LAUNCH_ORDER.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onPick(tab)}
            className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-white/[0.03] px-3.5 py-3 text-left transition-colors hover:border-border hover:bg-white/[0.06]"
          >
            <Icon name={panelMeta[tab].icon} className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{panelMeta[tab].title}</span>
            <kbd className="shrink-0 font-mono text-[11px] text-muted-foreground">{panelMeta[tab].kbd}</kbd>
          </button>
        ))}
      </div>
    </div>
  );
}

export function RightPane(): React.JSX.Element {
  const openTabs = useWorkbenchStore((s) => s.openTabs);
  const activeTab = useWorkbenchStore((s) => s.activeTab);
  const openTab = useWorkbenchStore((s) => s.openTab);
  const closeTab = useWorkbenchStore((s) => s.closeTab);
  const setActiveTab = useWorkbenchStore((s) => s.setActiveTab);

  // 从持久化设置恢复已开标签（首次挂载一次性）
  useEffect(() => {
    void window.pi.settingsGet().then((settings) => {
      const wb = (settings as { workbench?: { openTabs?: WorkbenchTab[]; activeTab?: WorkbenchTab | null } }).workbench;
      if (wb?.openTabs?.length) useWorkbenchStore.getState().hydrateTabs(wb.openTabs, wb.activeTab ?? null);
    });
  }, []);

  // 标签变化防抖写回
  useEffect(() => {
    const timer = setTimeout(() => void window.pi.settingsSet({ workbench: { openTabs, activeTab } }), 180);
    return () => clearTimeout(timer);
  }, [openTabs, activeTab]);

  if (openTabs.length === 0) {
    return (
      <div className="relative flex h-full min-w-0 flex-col bg-surface-app">
        <div className="absolute right-1.5 top-1.5 z-10">
          <ClosePaneButton />
        </div>
        <Launcher onPick={openTab} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-surface-app">
      <nav className="flex h-9 shrink-0 items-stretch gap-1 border-b border-border bg-surface-chrome pl-1.5 pr-1" aria-label="工作台面板">
        {openTabs.map((tab) => (
          <TabButton
            key={tab}
            tab={tab}
            active={tab === activeTab}
            onActivate={() => setActiveTab(tab)}
            onClose={() => closeTab(tab)}
          />
        ))}
        <span className="min-w-2 flex-1" />
        <AddTabMenu onPick={openTab} />
        <ClosePaneButton />
      </nav>
      <div className="relative min-h-0 flex-1">
        {openTabs.map((tab) => (
          <div key={tab} className={cn("absolute inset-0", tab === activeTab ? "block" : "hidden")}>
            <Suspense fallback={<LoadingPanel />}>{panelNode(tab)}</Suspense>
          </div>
        ))}
      </div>
    </div>
  );
}
