import { useEffect, useRef, useState } from "react";
import { Group, Panel, Separator, type PanelImperativeHandle } from "react-resizable-panels";
import { useSettingsStore } from "../../stores/settings-store";
import { cn } from "@/lib/utils";
import { TitleBar } from "./TitleBar";

/**
 * 折叠面板内容淡入淡出：收起时快速淡出+微位移（150ms ease-in），
 * 展开时等宽度动画先行、内容延迟淡入（delay 100ms / 250ms ease-out）。
 * 内容保持挂载（由外层 overflow 裁切），避免瞬间卸载的"啪"感。
 */
function PanelFade({ collapsed, slide, children }: { collapsed: boolean; slide: "left" | "right"; children: React.ReactNode }): React.JSX.Element {
  // 淡出动画播完（150ms）后卸载内容：收起态不留可聚焦元素；展开时立即挂回再淡入
  const [mounted, setMounted] = useState(!collapsed);
  useEffect(() => {
    if (!collapsed) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), 160);
    return () => clearTimeout(timer);
  }, [collapsed]);

  return (
    <div
      aria-hidden={collapsed || undefined}
      className={cn(
        "h-full transition-[opacity,transform] will-change-[opacity,transform]",
        collapsed
          ? slide === "left"
            ? "pointer-events-none -translate-x-2 opacity-0 duration-150 ease-in"
            : "pointer-events-none translate-x-2 opacity-0 duration-150 ease-in"
          : "translate-x-0 opacity-100 delay-100 duration-250 ease-out",
      )}
    >
      {mounted && children}
    </div>
  );
}

/**
 * T1.2 布局底座（UI v3）：全宽 TitleBar + react-resizable-panels v4 三栏
 * + 左右栏折叠 + 布局持久化到 ~/.pi-wood/settings.json。
 *
 * 分层色彩：chrome（顶栏/侧栏）= bg-surface-chrome，内容区 = bg-surface-app，
 * 唯一来源在 globals.css 的 --surface-* 令牌。
 * 折叠动画：非拖拽期给 Panel 加 flex-grow 过渡（expo 缓动）；面板内容固定最小宽度，
 * 收起时被 overflow 裁切而非挤压回流，配合 PanelFade 淡出。
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
  const [animate, setAnimate] = useState(true);
  const [l, c, r] = settings.window.layout;

  useEffect(() => {
    void load();
  }, [load]);

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
    // 打开某个面板时确保右侧栏可见（收起态自动展开，已展开则不动）
    const revealInspector = (): void => {
      if (useSettingsStore.getState().settings.window.rightCollapsed) {
        rightRef.current?.expand();
        void useSettingsStore.getState().patch({ window: { rightCollapsed: false } });
      }
    };
    window.addEventListener("piwood:toggle-inspector", toggleInspector);
    window.addEventListener("piwood:reveal-inspector", revealInspector);
    return () => {
      window.removeEventListener("piwood:toggle-inspector", toggleInspector);
      window.removeEventListener("piwood:reveal-inspector", revealInspector);
    };
  }, []);

  const toggleLeftSidebar = (): void => {
    const collapsed = Boolean(useSettingsStore.getState().settings.window.leftCollapsed);
    if (collapsed) leftRef.current?.expand();
    else leftRef.current?.collapse();
    void useSettingsStore.getState().patch({ window: { leftCollapsed: !collapsed } });
  };

  if (!loaded) return <div className="h-full bg-surface-app" />;

  // 拖拽分割条时禁用过渡（跟手），程序化折叠/展开时启用（expo 缓动收合）
  const anim = animate ? "transition-[flex-grow] duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)]" : undefined;
  const separatorProps = {
    onPointerDown: () => setAnimate(false),
    onPointerUp: () => setAnimate(true),
    className: "w-px bg-border transition-colors hover:bg-ring data-[resize-handle-active]:bg-ring",
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-chrome">
      <TitleBar
        leftCollapsed={Boolean(settings.window.leftCollapsed)}
        onToggleSidebar={toggleLeftSidebar}
      />
      <Group
        orientation="horizontal"
        className="min-h-0 flex-1"
        onLayoutChanged={(layout, meta) => {
          if (!meta.isUserInteraction) return;
          const total = Object.values(layout).reduce((a, b) => a + b, 0);
          if (total <= 0) return;
          const ids = ["left", "center", "right"];
          const pct = ids.map((id) => Math.round(((layout[id] ?? 0) / total) * 100));
          setLayout([pct[0], pct[1], pct[2]]);
        }}
      >
        <Panel id="left" panelRef={leftRef} defaultSize={`${l}%`} minSize="200px" maxSize="280px" collapsible collapsedSize={0} className={anim}>
          <div className="h-full min-w-[200px] overflow-hidden bg-surface-chrome">
            <PanelFade collapsed={Boolean(settings.window.leftCollapsed)} slide="left">
              {left}
            </PanelFade>
          </div>
        </Panel>
        <Separator {...separatorProps} className="w-1 bg-transparent" />
        <Panel id="center" defaultSize={`${c}%`} minSize="25%" className={anim}>
          <div className="h-full min-w-0 overflow-hidden rounded-tl-lg bg-surface-app">{center}</div>
        </Panel>
        <Separator {...separatorProps} />
        <Panel id="right" panelRef={rightRef} defaultSize={`${r}%`} minSize="260px" maxSize="55%" collapsible collapsedSize={0} className={anim}>
          <div className="h-full min-w-[260px] overflow-hidden border-l border-border">
            <PanelFade collapsed={Boolean(settings.window.rightCollapsed)} slide="right">
              {right}
            </PanelFade>
          </div>
        </Panel>
      </Group>
    </div>
  );
}
