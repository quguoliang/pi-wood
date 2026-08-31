import { lazy, Suspense, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DockviewComponent,
  themeDark,
  type GroupPanelPartInitParameters,
  type IContentRenderer,
  type SerializedDockview,
} from "dockview";
import "dockview/dist/styles/dockview.css";
import { Icon, type IconName } from "../ui/Icon";
import { type WorkbenchTab } from "../../stores/workbench-store";

const FilesPanel = lazy(() => import("./FilesPanel").then((module) => ({ default: module.FilesPanel })));
const TerminalPanel = lazy(() => import("./TerminalPanel").then((module) => ({ default: module.TerminalPanel })));
const BrowserPanel = lazy(() => import("./BrowserPanel").then((module) => ({ default: module.BrowserPanel })));
const DiffPanel = lazy(() => import("./DiffPanel").then((module) => ({ default: module.DiffPanel })));

const panelMeta: Record<WorkbenchTab, { title: string; icon: IconName }> = {
  files: { title: "文件", icon: "folder" },
  term: { title: "终端", icon: "terminal" },
  browser: { title: "浏览器", icon: "browser" },
  diff: { title: "变更", icon: "file" },
};

function LoadingPanel(): React.JSX.Element {
  return <div className="workbench-empty"><p>正在载入面板…</p></div>;
}

function panelNode(name: string): ReactNode {
  switch (name as WorkbenchTab) {
    case "files": return <FilesPanel />;
    case "term": return <TerminalPanel />;
    case "browser": return <BrowserPanel />;
    case "diff": return <DiffPanel />;
    default: return <div className="workbench-empty"><p>未知面板</p></div>;
  }
}

class ReactPanelRenderer implements IContentRenderer {
  readonly element = document.createElement("div");
  private root: Root | undefined;

  constructor(private readonly name: string) {
    this.element.className = "dockview-react-panel";
  }

  init(_params: GroupPanelPartInitParameters): void {
    this.root = createRoot(this.element);
    this.root.render(<Suspense fallback={<LoadingPanel />}>{panelNode(this.name)}</Suspense>);
  }

  dispose(): void {
    this.root?.unmount();
  }
}

function isSerializedLayout(value: unknown): value is SerializedDockview {
  return Boolean(value && typeof value === "object" && "grid" in value && "panels" in value);
}

function addPanel(dockview: DockviewComponent, tab: WorkbenchTab): void {
  const existing = dockview.panels.find((panel) => panel.id === tab);
  if (existing) {
    dockview.setActivePanel(existing);
    return;
  }
  dockview.addPanel({
    id: tab,
    component: tab,
    title: panelMeta[tab].title,
    renderer: tab === "term" ? "always" : "onlyWhenVisible",
  });
}

export function RightPane(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const dockviewRef = useRef<DockviewComponent>();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const dockview = new DockviewComponent(host, {
      theme: themeDark,
      createComponent: ({ name }) => new ReactPanelRenderer(name),
    });
    dockviewRef.current = dockview;
    let restoring = true;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;

    const onOpen = (event: Event): void => addPanel(dockview, (event as CustomEvent<WorkbenchTab>).detail);
    window.addEventListener("piwood:open-workbench", onOpen);

    const layoutDisposable = dockview.onDidLayoutChange(() => {
      if (restoring) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        void window.pi.settingsSet({ workbench: { layout: dockview.toJSON() } });
      }, 180);
    });

    const resize = new ResizeObserver(([entry]) => {
      dockview.layout(entry.contentRect.width, entry.contentRect.height);
    });
    resize.observe(host);

    void window.pi.settingsGet().then((settings) => {
      const layout = (settings as { workbench?: { layout?: unknown } }).workbench?.layout;
      try {
        if (isSerializedLayout(layout)) dockview.fromJSON(layout);
      } catch {
        // 版本升级或损坏布局时回退到默认文件面板。
      }
      if (dockview.panels.length === 0) addPanel(dockview, "files");
      restoring = false;
    });

    return () => {
      if (saveTimer) clearTimeout(saveTimer);
      window.removeEventListener("piwood:open-workbench", onOpen);
      resize.disconnect();
      layoutDisposable.dispose();
      dockview.dispose();
      dockviewRef.current = undefined;
    };
  }, []);

  return (
    <div className="right-pane dockview-shell">
      <nav className="workbench-launcher" aria-label="打开工作台面板">
        {(Object.keys(panelMeta) as WorkbenchTab[]).map((tab) => (
          <button key={tab} type="button" onClick={() => dockviewRef.current && addPanel(dockviewRef.current, tab)} title={`打开${panelMeta[tab].title}`}>
            <Icon name={panelMeta[tab].icon} />
            <span>{panelMeta[tab].title}</span>
          </button>
        ))}
      </nav>
      <div ref={hostRef} className="dockview-host" />
    </div>
  );
}
