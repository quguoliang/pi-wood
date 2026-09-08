import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Group, Panel, Separator, type PanelImperativeHandle } from "react-resizable-panels";
import { useSettingsStore } from "../../stores/settings-store";
import { cn } from "@/lib/utils";
import { WindowLights } from "./WindowLights";
import { WinWindowControls } from "./WinWindowControls";

const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * 折叠面板内容淡入淡出（GSAP）：内容常驻挂载（visibility 裁剪，tab 顺序自动剔除）。
 * 只做纯透明度——位移交给几何补间（宽度裁切本身就是运动），叠加位移会变成双重运动=视觉抖动。
 */
function PanelFade({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    gsap.killTweensOf(el);
    const reduced = prefersReducedMotion();
    if (collapsed) {
      gsap.to(el, { autoAlpha: 0, duration: reduced ? 0 : 0.15, ease: "power2.out" });
    } else {
      gsap.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: reduced ? 0 : 0.25, ease: "power2.out", clearProps: "opacity,visibility" });
    }
  }, [collapsed]);

  return <div ref={ref} className="h-full">{children}</div>;
}

/**
 * T1.2 布局底座（UI v4）：无全宽顶栏（macOS 红绿灯 / Windows 自绘窗口控制悬浮）+ 外层 Group（左栏 | 内容区）。
 * 内容区为中栏+右栏合并的圆角矩形整体，距窗口四边 12px（p-3），内部再用嵌套 Group 分栏。
 * 左右栏折叠 + 布局持久化到 ~/.pi-wood/settings.json（[l,c,r]，c/r 为内容区内百分比）。
 *
 * 分层色彩：chrome（顶栏/侧栏）= bg-surface-chrome，内容区 = bg-surface-app，
 * 唯一来源在 globals.css 的 --surface-* 令牌。
 * 折叠动画（GSAP）：程序化折叠/展开时对面板元素补间 flex-grow（面板库本身瞬时置值），
 * 内容淡入淡出由 PanelFade 同步演出；拖拽分割条不经过补间路径，天然跟手。
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
  const rootRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<PanelImperativeHandle | null>(null);
  const rightRef = useRef<PanelImperativeHandle | null>(null);
  // 几何动画：库是 flex-grow 唯一写入者，globals.css 的 .pane-anim [data-panel] 负责 transition
  // （Panel 的 className 落在嵌套 div 上，管不到外层 flexGrow——别再往 Panel className 上挂过渡）。
  // 初始 false 防启动折叠动画；拖拽分割条期间移除根类保跟手。
  const [paneTransition, setPaneTransition] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setPaneTransition(true));
    return () => cancelAnimationFrame(raf);
  }, []);
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
    (collapsed ? leftRef.current?.expand : leftRef.current?.collapse)?.call(leftRef.current);
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
      (collapsed ? rightRef.current?.expand : rightRef.current?.collapse)?.call(rightRef.current);
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

  return (
    <div ref={rootRef} className={cn("relative flex h-full min-h-0 flex-col overflow-hidden bg-surface-chrome", paneTransition && "pane-anim")}>
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
        {/* !overflow-hidden 压掉库嵌套层(overflow:auto)的滚动条：内容 min-w 在收起时被裁切而非出滚动条抖动 */}
        <Panel id="left" panelRef={leftRef} defaultSize={`${l}%`} minSize="200px" maxSize="280px" collapsible collapsedSize={0} className="!overflow-hidden" onResize={(size) => syncCollapsed("leftCollapsed", size.asPercentage)}>
          <div className="h-full min-w-[200px] overflow-hidden bg-surface-chrome">
            <PanelFade collapsed={Boolean(settings.window.leftCollapsed)}>
              {left}
            </PanelFade>
          </div>
        </Panel>
        {/* 收起时不卸载只收窄（w-0）：hidden 卸载会让相邻栏瞬移一个手柄宽度 */}
        <Separator
          onPointerDown={() => setPaneTransition(false)}
          onPointerUp={() => setPaneTransition(true)}
          className={cn("bg-transparent transition-[width]", Boolean(settings.window.leftCollapsed) ? "w-0 pointer-events-none" : "w-1")}
        />
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
                <Panel id="center" defaultSize={`${ci}%`} minSize="25%">
                  <div className="h-full min-w-0 overflow-hidden">{center}</div>
                </Panel>
                {/* 拖拽手柄保留（col-resize 光标），可见纵线由 RightPane 内容区 border-l 提供——不进头部带 */}
                <Separator
                  onPointerDown={() => setPaneTransition(false)}
                  onPointerUp={() => setPaneTransition(true)}
                  className={cn("bg-transparent transition-[width]", Boolean(settings.window.rightCollapsed) ? "w-0 pointer-events-none" : "w-px")}
                />
                <Panel id="right" panelRef={rightRef} defaultSize={`${ri}%`} minSize="260px" maxSize="55%" collapsible collapsedSize={0} className="!overflow-hidden" onResize={(size) => syncCollapsed("rightCollapsed", size.asPercentage)}>
                  <div className="h-full min-w-[260px] overflow-hidden">
                    <PanelFade collapsed={Boolean(settings.window.rightCollapsed)}>
                      {right}
                    </PanelFade>
                  </div>
                </Panel>
              </Group>
            </div>
          </div>
        </Panel>
      </Group>
      {/* 双平台均无全宽顶栏：macOS=自绘红绿灯，Windows=右上自绘窗口控制。
          必须渲染在 Group 之后：可拖拽区域按 DOM 顺序累积，先渲染的 no-drag 会被
          后处理的 app-drag（header/nav 拖拽带）重新盖住 → 窗口控制按钮点不动 */}
      {window.pi.platform === "darwin" && <WindowLights />}
      {window.pi.platform === "win32" && <WinWindowControls />}
    </div>
  );
}
