import { useEffect, useRef, useState } from "react";
import { Group, Panel, Separator, type PanelImperativeHandle } from "react-resizable-panels";
import { useSettingsStore } from "../../stores/settings-store";
import { cn } from "@/lib/utils";
import { TitleBar } from "./TitleBar";
import { WindowLights } from "./WindowLights";

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
 * T1.2 布局底座（UI v3）：全宽 TitleBar（仅左栏开关）+ 外层 Group（左栏 | 内容区）。
 * 内容区为中栏+右栏合并的圆角矩形整体，距窗口四边 12px（p-3），内部再用嵌套 Group 分栏。
 * 左右栏折叠 + 布局持久化到 ~/.pi-wood/settings.json（[l,c,r]，c/r 为内容区内百分比）。
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
  // 旧存档的 c/r 是相对整窗的百分比；新结构里中栏+右栏在内层 Group 内分栏，归一化为内容区百分比
  const innerTotal = c + r || 100;
  const ci = (c / innerTotal) * 100;
  const ri = (r / innerTotal) * 100;

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loaded) return;
    if (settings.window.leftCollapsed) leftRef.current?.collapse();
    if (settings.window.rightCollapsed) rightRef.current?.collapse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const toggleLeftSidebar = (): void => {
    const collapsed = Boolean(useSettingsStore.getState().settings.window.leftCollapsed);
    if (collapsed) leftRef.current?.expand();
    else leftRef.current?.collapse();
    void useSettingsStore.getState().patch({ window: { leftCollapsed: !collapsed } });
  };

  // v4 无 onCollapse 回调：拖拽把面板收到 0 时设置值不会变，用 onResize 反同步真实折叠态，
  // 保证「收起态接力开关」等依赖设置的渲染不漏出（仅在布尔翻转时写回，避免拖拽期高频 patch）
  const syncCollapsed = (key: "leftCollapsed" | "rightCollapsed", sizePct: number): void => {
    const collapsed = sizePct < 0.5;
    if (useSettingsStore.getState().settings.window[key] !== collapsed) {
      void useSettingsStore.getState().patch({ window: { [key]: collapsed } });
    }
  };

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
    // 左栏开关两态分别渲染在 LeftPane（拖拽栏内，no-drag 子元素）与 ConversationHeader（收起态）
    window.addEventListener("piwood:toggle-sidebar", toggleLeftSidebar);
    window.addEventListener("piwood:toggle-inspector", toggleInspector);
    window.addEventListener("piwood:reveal-inspector", revealInspector);
    return () => {
      window.removeEventListener("piwood:toggle-sidebar", toggleLeftSidebar);
      window.removeEventListener("piwood:toggle-inspector", toggleInspector);
      window.removeEventListener("piwood:reveal-inspector", revealInspector);
    };
  }, []);

  if (!loaded) return <div className="h-full bg-surface-app" />;

  // 拖拽分割条时禁用过渡（跟手），程序化折叠/展开时启用（expo 缓动收合）
  const anim = animate ? "transition-[flex-grow] duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)]" : undefined;
  const separatorProps = {
    onPointerDown: () => setAnimate(false),
    onPointerUp: () => setAnimate(true),
    className: "w-px bg-border transition-colors hover:bg-ring data-[resize-handle-active]:bg-ring",
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-surface-chrome">
      <TitleBar onToggleSidebar={toggleLeftSidebar} />
      {window.pi.platform === "darwin" && <WindowLights />}
      <Group
        orientation="horizontal"
        className="min-h-0 flex-1"
        onLayoutChanged={(layout, meta) => {
          if (!meta.isUserInteraction) return;
          const total = (layout.left ?? 0) + (layout.content ?? 0);
          if (total <= 0) return;
          const saved = useSettingsStore.getState().settings.window.layout;
          setLayout([Math.round(((layout.left ?? 0) / total) * 100), saved[1], saved[2]]);
        }}
      >
        <Panel id="left" panelRef={leftRef} defaultSize={`${l}%`} minSize="200px" maxSize="280px" collapsible collapsedSize={0} className={anim} onResize={(size) => syncCollapsed("leftCollapsed", size.asPercentage)}>
          <div className="h-full min-w-[200px] overflow-hidden bg-surface-chrome">
            <PanelFade collapsed={Boolean(settings.window.leftCollapsed)} slide="left">
              {left}
            </PanelFade>
          </div>
        </Panel>
        <Separator {...separatorProps} className={cn("w-1 bg-transparent transition-colors", Boolean(settings.window.leftCollapsed) && "hidden")} />
        <Panel id="content" defaultSize={`${100 - l}%`}>
          {/* 中栏+右栏合并为一个圆角矩形整体：距窗口四边均 6px（环带可拖拽移窗），内部再分栏 */}
          <div className="app-drag h-full p-1.5">
            <div className="app-no-drag flex h-full min-w-0 overflow-hidden rounded-lg bg-surface-app">
              <Group
                orientation="horizontal"
                className="h-full min-w-0 flex-1"
                onLayoutChanged={(layout, meta) => {
                  if (!meta.isUserInteraction) return;
                  const total = (layout.center ?? 0) + (layout.right ?? 0);
                  if (total <= 0) return;
                  const saved = useSettingsStore.getState().settings.window.layout;
                  setLayout([saved[0], Math.round(((layout.center ?? 0) / total) * 100), Math.round(((layout.right ?? 0) / total) * 100)]);
                }}
              >
                <Panel id="center" defaultSize={`${ci}%`} minSize="25%" className={anim}>
                  <div className="h-full min-w-0 overflow-hidden">{center}</div>
                </Panel>
                <Separator {...separatorProps} className={cn("w-px bg-border transition-colors hover:bg-ring data-[resize-handle-active]:bg-ring", Boolean(settings.window.rightCollapsed) && "hidden")} />
                <Panel id="right" panelRef={rightRef} defaultSize={`${ri}%`} minSize="260px" maxSize="55%" collapsible collapsedSize={0} className={anim} onResize={(size) => syncCollapsed("rightCollapsed", size.asPercentage)}>
                  <div className="h-full min-w-[260px] overflow-hidden border-l border-border">
                    <PanelFade collapsed={Boolean(settings.window.rightCollapsed)} slide="right">
                      {right}
                    </PanelFade>
                  </div>
                </Panel>
              </Group>
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  );
}
