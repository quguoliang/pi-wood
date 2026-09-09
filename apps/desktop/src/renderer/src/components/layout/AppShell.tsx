import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Group, Panel, Separator, type GroupImperativeHandle, type PanelImperativeHandle } from "react-resizable-panels";
import { useSettingsStore } from "../../stores/settings-store";
import { cn } from "@/lib/utils";
import { WindowLights } from "./WindowLights";
import { WinWindowControls } from "./WinWindowControls";

const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 折叠补间时长/曲线：与 MessageMinimap 同一族（power 系 out，快进慢出）。 */
const COLLAPSE_DURATION = 0.3;
const COLLAPSE_EASE = "power3.out";

/**
 * 折叠面板内容淡入淡出（GSAP）：内容常驻挂载（visibility 裁剪，tab 顺序自动剔除）。
 * 只做纯透明度——位移交给几何补间（宽度裁切本身就是运动），叠加位移会变成双重运动=视觉抖动。
 * 时长与几何补间同拍（0.3s），避免「宽度还在动、内容已闪现」的两拍错位。
 */
function PanelFade({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    gsap.killTweensOf(el);
    const reduced = prefersReducedMotion();
    if (collapsed) {
      // 淡出比几何快半拍：宽度收到一半时内容已隐，避免「内容被压扁」的挤压感
      gsap.to(el, { autoAlpha: 0, duration: reduced ? 0 : COLLAPSE_DURATION * 0.5, ease: "power2.out" });
    } else {
      // 展开时内容等宽度让出位置后再淡入（delay 半拍），从「已展开的空白」里浮现而非被拉伸
      gsap.fromTo(
        el,
        { autoAlpha: 0 },
        {
          autoAlpha: 1,
          duration: reduced ? 0 : COLLAPSE_DURATION * 0.6,
          delay: reduced ? 0 : COLLAPSE_DURATION * 0.4,
          ease: "power2.out",
          clearProps: "opacity,visibility",
        },
      );
    }
  }, [collapsed]);

  return <div ref={ref} className="h-full">{children}</div>;
}

/**
 * 程序化折叠/展开的 GSAP 补间驱动。
 *
 * 抖动根因（旧实现）：靠 CSS `transition: flex-grow` 补间——flexGrow 触发整列 relayout，
 * 库每帧回写内联 flexGrow 与 transition 叠加，产生双写竞争；且 collapse() 单步跳变
 * 让 transition 从错起点起拍。
 *
 * 修法：GSAP 每帧经 `group.setLayout()` 显式写百分比布局（库的单一写入路径），
 * 面板库不再自发跳变，CSS flex-grow transition 随之退役。拖拽分割条不经过此路径。
 *
 * ⚠️ toLayout 返回的对象 key 必须按该 Group 内 Panel 的 DOM 顺序插入：
 * 库的 setLayout 校验（v4 内部 X()）把 Object.values(layout) 与 panelConstraints
 * 按「下标」zip——先 clamp 再按 Object.keys(layout) 插装回写。key 顺序 ≠ DOM 顺序时，
 * 甲面板的值会被乙面板的 min/max 钳制（如右栏收 0 被中栏 minSize 25% 拦成 25），
 * 且错序 map 会被 commit 成组内存布局，后续拖拽/补间全部串位
 * （实机表现：关右栏后中栏被右栏的 minSize 0 压到极窄）。
 *
 * 连点安全：tween 登记在 group 元素上（activeTweens），新 toggle 先 killTweensOf 全清
 * 再起拍——旧实现 tween 挂在每次新建的临时 proxy 上，连点会两条补间并行打架（视觉=方向反了）。
 */
const activeTweens = new WeakMap<GroupImperativeHandle, gsap.core.Tween>();

function killActiveTween(group: GroupImperativeHandle): void {
  activeTweens.get(group)?.kill();
  activeTweens.delete(group);
}

function animateLayout(
  group: GroupImperativeHandle | null,
  toLayout: (pct: number) => { [panelId: string]: number },
  fromPct: number,
  toPct: number,
  onDone?: () => void,
): void {
  if (!group) {
    onDone?.();
    return;
  }
  killActiveTween(group);
  if (prefersReducedMotion()) {
    group.setLayout(toLayout(toPct));
    onDone?.();
    return;
  }
  const proxy = { pct: fromPct };
  const tween = gsap.to(proxy, {
    pct: toPct,
    duration: COLLAPSE_DURATION,
    ease: COLLAPSE_EASE,
    onUpdate: () => {
      group.setLayout(toLayout(proxy.pct));
    },
    onComplete: () => {
      activeTweens.delete(group);
      onDone?.();
    },
    onInterrupt: () => {
      activeTweens.delete(group);
      onDone?.();
    },
  });
  activeTweens.set(group, tween);
}

/**
 * T1.2 布局底座（UI v4）：无全宽顶栏（macOS 红绿灯 / Windows 自绘窗口控制悬浮）+ 外层 Group（左栏 | 内容区）。
 * 内容区为中栏+右栏合并的圆角矩形整体，距窗口四边 12px（p-3），内部再用嵌套 Group 分栏。
 * 左右栏折叠 + 布局持久化到 ~/.pi-wood/settings.json（[l,c,r]，c/r 为内容区内百分比）。
 *
 * 分层色彩：chrome（顶栏/侧栏）= bg-surface-chrome，内容区 = bg-surface-app，
 * 唯一来源在 globals.css 的 --surface-* 令牌。
 * 折叠动画（GSAP）：程序化折叠/展开经 animateLayout 每帧 setLayout 补间，
 * 内容淡入淡出由 PanelFade 同拍演出；拖拽分割条不经过补间路径，天然跟手。
 *
 * 折叠态四铁律（修「关右栏后中栏被挤到最左/右栏铺满」）：
 * 1. 展开永远回到持久化比例（toggle 补间/挂载恢复都写回 l/ri）——expand() 重载后丢
 *    expandToSize 会回落 minSize，窄窗下 260px 即半屏（表现为「点关闭反而铺满」）；
 * 2. 折叠态不落盘 layout——拖拽收到 0 释放的 commit 是 isUserInteraction，会把 [c=100,r=0]
 *    存成永久 defaultSize，重载即压塌右栏；
 * 3. 折叠标记只在「开关」与「拖拽释放 commit」两处同步——onResize 反同步会被挂载误测
 *    （窄窗首帧 minSize% 过大直接压塌面板）与补间中间帧写飘；
 * 4. setLayout 的对象 key 必须按 Panel 的 DOM 顺序插入——库（v4）按下标 zip 值与约束，
 *    反序会让两栏 min/max 互换钳制（关右栏 → 中栏被挤成极窄条）。
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
  const outerGroupRef = useRef<GroupImperativeHandle | null>(null);
  const innerGroupRef = useRef<GroupImperativeHandle | null>(null);
  // 补间进行中屏蔽 onResize 反同步（每帧 setLayout 会触发 onResize，误把中间帧当用户拖拽）
  const animatingRef = useRef(false);

  const [l, c, r] = settings.window.layout;
  // 旧存档的 c/r 是相对整窗的百分比；新结构里中栏+右栏在内层 Group 内分栏，归一化为内容区百分比
  const innerTotal = c + r || 100;
  const ci = (c / innerTotal) * 100;
  const ri = (r / innerTotal) * 100;

  useEffect(() => {
    void load();
  }, [load]);

  /** 左栏展开/收起的目标百分比：收起 0；展开回设置里存的用户宽度 l。 */
  const toggleLeftSidebar = (): void => {
    const collapsed = Boolean(useSettingsStore.getState().settings.window.leftCollapsed);
    const group = outerGroupRef.current;
    const layout = group?.getLayout() ?? {};
    const current = layout.left ?? (collapsed ? 0 : l);
    const target = collapsed ? l : 0;
    void useSettingsStore.getState().patch({ window: { leftCollapsed: !collapsed } });
    if (!group) {
      // group 未就绪（理论上不该发生）：退回库瞬时路径兜底
      (collapsed ? leftRef.current?.expand : leftRef.current?.collapse)?.call(leftRef.current);
      return;
    }
    animatingRef.current = true;
    // key 顺序 = 外层 Group 面板 DOM 顺序（left → content）
    animateLayout(group, (p) => ({ left: p, content: 100 - p }), current, target, () => {
      animatingRef.current = false;
    });
  };

  const toggleRightSidebar = (): void => {
    const collapsed = Boolean(useSettingsStore.getState().settings.window.rightCollapsed);
    const group = innerGroupRef.current;
    // 补间进行中连点：先停掉旧补间（onInterrupt 会清动画标志），再以当前真实宽度为起点反向，
    // 避免「旧 tween 继续跑、标志被清、两补间打架」。
    const layout = group?.getLayout() ?? {};
    const currentRight = layout.right ?? (collapsed ? 0 : ri);
    const targetRight = collapsed ? ri : 0;
    void useSettingsStore.getState().patch({ window: { rightCollapsed: !collapsed } });
    if (!group) {
      (collapsed ? rightRef.current?.expand : rightRef.current?.collapse)?.call(rightRef.current);
      return;
    }
    animatingRef.current = true;
    // key 顺序 = 内层 Group 面板 DOM 顺序（center → right）；
    // 旧实现 { right, center } 与 DOM 序相反，库按下标 zip 约束 → 两栏 min/max 互换，
    // 表现为「关右栏反而把中栏挤到极窄」
    animateLayout(group, (p) => ({ center: 100 - p, right: p }), currentRight, targetRight, () => {
      animatingRef.current = false;
    });
  };

  // 首次加载恢复折叠态：瞬时（无补间），启动不该放动画。
  // 挂载收敛到持久化折叠态：库按约束校正初始布局，窄窗下可能把面板压塌，
  // 与折叠标记相悖时以标记为准，按持久化比例重开
  useEffect(() => {
    if (!loaded) return;
    if (settings.window.leftCollapsed) outerGroupRef.current?.setLayout({ left: 0, content: 100 });
    else {
      const outer = outerGroupRef.current?.getLayout() ?? {};
      if ((outer.left ?? 0) <= 0 && l > 0) outerGroupRef.current?.setLayout({ left: l, content: 100 - l });
    }
    if (settings.window.rightCollapsed) innerGroupRef.current?.setLayout({ center: 100, right: 0 });
    else {
      const inner = innerGroupRef.current?.getLayout() ?? {};
      if ((inner.right ?? 0) <= 0 && ri > 0) innerGroupRef.current?.setLayout({ center: 100 - ri, right: ri });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // 折叠标记同步：只在用户拖拽释放（isUserInteraction commit）时对齐真实几何，
  // 避开挂载误测与补间中间帧；patch 仅在布尔翻转时写（拖拽期不高频打 IPC）
  const syncFlagFromLayout = (key: "leftCollapsed" | "rightCollapsed", collapsed: boolean): void => {
    if (animatingRef.current) return; // 补间中间帧不是用户意图
    if (useSettingsStore.getState().settings.window[key] !== collapsed) {
      void useSettingsStore.getState().patch({ window: { [key]: collapsed } });
    }
  };

  useEffect(() => {
    // 打开某个面板时确保右侧栏可见（收起态自动展开，已展开则不动）
    const revealInspector = (): void => {
      if (useSettingsStore.getState().settings.window.rightCollapsed) {
        toggleRightSidebar();
      }
    };
    // 左栏开关两态分别渲染在 LeftPane（拖拽栏内，no-drag 子元素）与 ConversationHeader（收起态）
    window.addEventListener("piwood:toggle-sidebar", toggleLeftSidebar);
    window.addEventListener("piwood:toggle-inspector", toggleRightSidebar);
    window.addEventListener("piwood:reveal-inspector", revealInspector);
    return () => {
      window.removeEventListener("piwood:toggle-sidebar", toggleLeftSidebar);
      window.removeEventListener("piwood:toggle-inspector", toggleRightSidebar);
      window.removeEventListener("piwood:reveal-inspector", revealInspector);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loaded) return <div className="h-full bg-surface-app" />;

  return (
    <div ref={rootRef} className="relative flex h-full min-h-0 flex-col overflow-hidden bg-surface-chrome">
      <Group
        orientation="horizontal"
        className="min-h-0 flex-1"
        groupRef={outerGroupRef}
        onLayoutChanged={(layout, meta) => {
          if (!meta.isUserInteraction) return;
          const left = layout.left ?? 0;
          // 拖拽释放 commit：对齐折叠标记（拖到 0 = 折叠，从 0 拖出 = 展开）
          syncFlagFromLayout("leftCollapsed", left <= 0);
          if (left <= 0) return; // 折叠态不落盘，保留上次展开比例
          const total = left + (layout.content ?? 0);
          if (total <= 0) return;
          const saved = useSettingsStore.getState().settings.window.layout;
          setLayout([Math.round((left / total) * 100), saved[1], saved[2]]);
        }}
      >
        {/* !overflow-hidden 压掉库嵌套层(overflow:auto)的滚动条：内容 min-w 在收起时被裁切而非出滚动条抖动 */}
        <Panel id="left" panelRef={leftRef} defaultSize={`${l}%`} minSize="200px" maxSize="280px" collapsible collapsedSize={0} className="!overflow-hidden">
          <div className="h-full min-w-[200px] overflow-hidden bg-surface-chrome">
            <PanelFade collapsed={Boolean(settings.window.leftCollapsed)}>
              {left}
            </PanelFade>
          </div>
        </Panel>
        {/* 收起时不卸载只收窄（w-0）：hidden 卸载会让相邻栏瞬移一个手柄宽度 */}
        <Separator
          className={cn("bg-transparent transition-[width]", Boolean(settings.window.leftCollapsed) ? "w-0 pointer-events-none" : "w-1")}
        />
        <Panel id="content" defaultSize={`${100 - l}%`} minSize={0}>
          {/* 中栏+右栏各为独立圆角卡片（参考图样式）：两张卡片间透出 chrome 底色间隙，
              拖拽环带（p-1.5）统一承载移窗区；卡片自带 border+rounded，底线不再跨栏通铺 */}
          <div className="app-drag flex h-full min-w-0 gap-1.5 p-1.5">
            <Group
              orientation="horizontal"
              className="h-full min-w-0 flex-1"
              groupRef={innerGroupRef}
              onLayoutChanged={(layout, meta) => {
                if (!meta.isUserInteraction) return;
                const right = layout.right ?? 0;
                // 拖拽释放 commit：对齐折叠标记（拖到 0 = 折叠，从 0 拖出 = 展开）
                syncFlagFromLayout("rightCollapsed", right <= 0);
                if (right <= 0) return; // 折叠态不落盘，保留上次展开比例
                const total = (layout.center ?? 0) + right;
                if (total <= 0) return;
                const saved = useSettingsStore.getState().settings.window.layout;
                setLayout([saved[0], Math.round(((layout.center ?? 0) / total) * 100), Math.round((right / total) * 100)]);
              }}
            >
              <Panel id="center" defaultSize={`${ci}%`} minSize="25%">
                <div className="app-no-drag h-full min-w-0 overflow-hidden rounded-lg border border-border/60 bg-surface-app">{center}</div>
              </Panel>
              {/* 拖拽手柄：透明占位（两张卡片的间隙就是命中区），col-resize 光标提示可拖 */}
              <Separator
                className={cn("bg-transparent transition-[width]", Boolean(settings.window.rightCollapsed) ? "w-0 pointer-events-none" : "w-px")}
              />
              {/* minSize/maxSize 随折叠态换挡（关键修复）：
                  库的 px→% 约束按「panel 实际像素宽之和」换算。右栏展开时基线≈整组宽，260px≈18% 正常；
                  一旦右栏被钳到 0 宽、基线塌成只剩中栏，260px 会膨胀成 40%+——此后每帧 setLayout 想写 <45%
                  都被「minSize 兜底」拦下，want→0 applied 恒 45（实机日志实证），右栏再也收不掉。
                  折叠期干脆摘掉像素约束（min=0 max=100），补间畅通归零；展开时恢复。 */}
              <Panel
                id="right"
                panelRef={rightRef}
                defaultSize={`${ri}%`}
                minSize={settings.window.rightCollapsed ? 0 : "260px"}
                maxSize={settings.window.rightCollapsed ? 100 : "55%"}
                collapsible
                collapsedSize={0}
                className="!overflow-hidden"
              >
                {/* 两闸齐下防「站位一直在」：
                    ① min-w 只在展开时挂——收起时卡 0 宽会让库把 0 钳回最小尺寸（0 < minSize 时库 Z() 会弹回 minSize 或 collapsedSize，配合 min-w 就把 0 宽判成非法）；
                    ② collapsed 时 border/rounded/bg 全摘——否则哪怕宽=0，边框/背景仍在窗右缘画一条细条（截图右侧那条灰） */}
                <div
                  className={cn(
                    "app-no-drag h-full overflow-hidden",
                    settings.window.rightCollapsed
                      ? "border-transparent"
                      : "min-w-[260px] rounded-lg border border-border/60 bg-surface-app",
                  )}
                >
                  <PanelFade collapsed={Boolean(settings.window.rightCollapsed)}>
                    {right}
                  </PanelFade>
                </div>
              </Panel>
            </Group>
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
