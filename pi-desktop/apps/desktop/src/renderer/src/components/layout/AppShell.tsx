import { useEffect, useRef } from "react";
import { Group, Panel, Separator, type PanelImperativeHandle } from "react-resizable-panels";
import { useSettingsStore } from "../../stores/settings-store";

/**
 * T1.2 布局底座：react-resizable-panels v4（Group/Panel/Separator）三栏
 * + 左右栏折叠 + 布局持久化到 ~/.pi-desktop/settings.json。
 * 说明：v4 的 Layout 是 {panelId: flexGrow}，持久化时换算为百分比四元组。
 * 右栏内部 dockview 工作台在 T2.5 挂载。
 */
export function AppShell({
  left,
  center,
  right,
  statusbar,
}: {
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
  statusbar?: React.ReactNode;
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
    if (settings.window.rightCollapsed) rightRef.current?.collapse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  if (!loaded) return <div className="app-shell" />;

  const toggleRight = (): void => {
    const collapsed = useSettingsStore.getState().settings.window.rightCollapsed;
    if (collapsed) rightRef.current?.expand();
    else rightRef.current?.collapse();
    void useSettingsStore.getState().patch({ window: { rightCollapsed: !collapsed } });
  };

  return (
    <div className="app-shell">
      <header className="top-bar">
        <strong>PiDesk</strong>
        <span className="spacer" />
        <button className="ghost-btn" onClick={() => leftRef.current?.collapse()}>收左栏</button>
        <button className="ghost-btn" onClick={() => leftRef.current?.resize(`${l}%`)}>展开左栏</button>
        <button className="ghost-btn" onClick={toggleRight}>
          {settings.window.rightCollapsed ? "展开右栏" : "收右栏"}
        </button>
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
        <Panel id="left" panelRef={leftRef} defaultSize={`${l}%`} minSize="12%" maxSize="45%" collapsible collapsedSize={0}>
          <div className="panel-inner">{left}</div>
        </Panel>
        <Separator className="panel-handle" />
        <Panel id="center" defaultSize={`${c}%`} minSize="25%">
          <div className="panel-inner">{center}</div>
        </Panel>
        <Separator className="panel-handle" />
        <Panel id="right" panelRef={rightRef} defaultSize={`${r}%`} minSize="15%" collapsible collapsedSize={0}>
          <div className="panel-inner">{right}</div>
        </Panel>
      </Group>
      <footer className="status-bar">{statusbar}</footer>
    </div>
  );
}
