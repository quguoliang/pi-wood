import { useEffect, useRef } from "react";
import { Group, Panel, Separator, type PanelImperativeHandle } from "react-resizable-panels";
import { useSettingsStore } from "../../stores/settings-store";
import { Icon } from "../ui/Icon";

/**
 * T1.2 布局底座：react-resizable-panels v4（Group/Panel/Separator）三栏
 * + 左右栏折叠 + 布局持久化到 ~/.pi-wood/settings.json。
 * 说明：v4 的 Layout 是 {panelId: flexGrow}，持久化时换算为百分比四元组。
 * 右栏内部 dockview 工作台在 T2.5 挂载。
 */
export function AppShell({
  left,
  center,
  right,
}: {
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
}) {
  const { settings, loaded, load, setLayout } = useSettingsStore();
  const leftRef = useRef<PanelImperativeHandle | null>(null);
  const rightRef = useRef<PanelImperativeHandle | null>(null);
  const [l, c, r] = settings.window.layout;

  useEffect(() => {
    void load();
  }, [load]);

  // 启动时恢复右栏折叠状态（挂载后一次性）
  useEffect(() => {
    if (!loaded) return;
    if (settings.window.leftCollapsed) leftRef.current?.collapse();
    if (settings.window.rightCollapsed) rightRef.current?.collapse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => {
    const toggleInspector = (): void => {
      const collapsed = useSettingsStore.getState().settings.window.rightCollapsed;
      if (collapsed) rightRef.current?.expand();
      else rightRef.current?.collapse();
      void useSettingsStore.getState().patch({ window: { rightCollapsed: !collapsed } });
    };
    window.addEventListener("piwood:toggle-inspector", toggleInspector);
    return () => window.removeEventListener("piwood:toggle-inspector", toggleInspector);
  }, []);

  const toggleLeftSidebar = (): void => {
    const collapsed = Boolean(useSettingsStore.getState().settings.window.leftCollapsed);
    if (collapsed) leftRef.current?.expand();
    else leftRef.current?.collapse();
    void useSettingsStore.getState().patch({ window: { leftCollapsed: !collapsed } });
  };

  if (!loaded) return <div className="app-shell" />;

  return (
    <div className={`app-shell${settings.window.leftCollapsed ? " sidebar-collapsed" : ""}`}>
      <header className="window-chrome" aria-label="窗口操作">
        <span className="window-chrome-traffic-light-space" />
        <button type="button" onClick={toggleLeftSidebar} aria-label="展开或收起项目栏" title="展开或收起项目栏">
          <Icon name="panel" size={15} />
        </button>
        {settings.window.leftCollapsed && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("piwood:new-session"))}
            aria-label="新建会话"
            title="新建会话"
          >
            <Icon name="add" size={16} />
          </button>
        )}
      </header>
      <Group
        orientation="horizontal"
        className="panels"
        onLayoutChanged={(layout, meta) => {
          if (!meta.isUserInteraction) return;
          const total = Object.values(layout).reduce((a, b) => a + b, 0);
          if (total <= 0) return;
          const ids = ["left", "center", "right"];
          const pct = ids.map((id) => Math.round(((layout[id] ?? 0) / total) * 100));
          setLayout([pct[0], pct[1], pct[2]]);
        }}
      >
        <Panel id="left" panelRef={leftRef} defaultSize={`${l}%`} minSize="220px" maxSize="420px" collapsible collapsedSize={0}>
          <div className="panel-inner">
            {!settings.window.leftCollapsed && left}
          </div>
        </Panel>
        <Separator className="panel-handle" />
        <Panel id="center" defaultSize={`${c}%`} minSize="25%">
          <div className="panel-inner">{center}</div>
        </Panel>
        <Separator className="panel-handle" />
        <Panel id="right" panelRef={rightRef} defaultSize={`${r}%`} minSize="260px" maxSize="55%" collapsible collapsedSize={0}>
          <div className="panel-inner">{right}</div>
        </Panel>
      </Group>
    </div>
  );
}
