import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { cn } from "@/lib/utils";
import { CONTEXT_TREE_MIN_CENTER_WIDTH } from "../../lib/context-tree";
import { buildNavTicks, tickWidthAt } from "../../lib/message-nav";
import { subscribeOutlineAnchor } from "../../lib/outline-bus";
import { useActiveConversation, useSessionStore } from "../../stores/session-store";
import { useConversationsStore } from "../../stores/conversations-store";
import { useContextTreeStore } from "../../stores/context-tree-store";

/**
 * T9.2 v2.2 MessageMinimap：消息列左缘**竖向居中**的浮层刻度条（不占布局宽度）。
 *
 * 形态（2026-09-12 裁决迭代）：
 * - **每个 user 轮次 + 每条 agent 正文回复各一条刻度**（thinking/tool/system 不成刻度）：
 *   问/答**等长**（10px），只靠深浅区分种类——回复刻度更淡；hover 浮层加「问/答」前缀；
 *   回复摘要只取正文首行、超长省略号截断（lib/message-nav firstLine）；
 * - **常态所有刻度完全一样**（等长）——**不做默认高亮**，当前阅读轮次也不例外；
 * - **hover 才动**：以目标为中心做正态分布衰减（目标 20px、相邻按高斯渐次变长、远端回 10px，200ms ease），
 *   离开后整列回到等长；
 * - hover 只在右侧浮出**当前这一条**的摘要（diff bars + 首行标题），**不列出其他轮次**；
 * - 点击刻度 → 派发 `piwood:outline-jump`（MessageList 既有监听：scrollToIndex + 行 flash 高亮）；
 * - 阅读锚点（lib/outline-bus，MessageList scroll-spy 发布）只用于**长对话时刻度条内部跟随滚动**，不产生视觉高亮；
 * - 轮次过多时刻度条内部滚动（藏滚动条）；宿主容器 <720px 自动隐藏；轮末顺带刷会话树（供 fork 对齐）。
 *
 * 刻度/衰减/bars 的纯逻辑在 lib/message-nav.ts（单测覆盖）；颜色全走主题 token，浅暗色自动适配。
 */

const TICK_BASE = 10; // 刻度常态长度（问/答等长，靠深浅区分种类：回复更淡）
const TICK_MAX = 20; // hover 目标刻度长度（邻居按高斯衰减介于两者之间）
const SIGMA = 1.6; // 正态衰减系数（越大→邻居被带得越长）
const RAIL_WIDTH = TICK_MAX; // 容器预留满宽，展开时不推动布局
const RAIL_ROW_HEIGHT = 12; // 刻度行高
const TIP_GUTTER = 8; // 刻度条 ↔ 摘要浮层间距
const TIP_CLOSE_DELAY = 120; // 沿刻度条平移时不闪断
const RAIL_MAX_HEIGHT = "70vh"; // 轮次过多时内部滚动，不出消息列

export function MessageMinimap(): React.JSX.Element | null {
  const items = useActiveConversation((c) => c.items);
  const streaming = useActiveConversation((c) => c.streaming);
  const activeConversationId = useSessionStore((s) => s.activeConversationId);
  const sessionFile = useConversationsStore((s) => s.rows.find((r) => r.id === activeConversationId)?.sessionFile);
  const refreshTree = useContextTreeStore((s) => s.refresh);

  const ticks = useMemo(() => buildNavTicks(items), [items]);

  // 会话树刷新：切对话/会话文件变化刷一次，轮末（streaming true→false）强刷一次。
  // 树数据供消息级「分叉」做 行↔会话树条目 序号对齐（fork 需要 user 条目的 entry id）。
  useEffect(() => {
    if (activeConversationId && sessionFile) void refreshTree(activeConversationId, sessionFile);
  }, [activeConversationId, sessionFile, refreshTree]);
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !streaming && activeConversationId && sessionFile) {
      void refreshTree(activeConversationId, sessionFile, { force: true });
    }
    wasStreaming.current = streaming;
  }, [streaming, activeConversationId, sessionFile, refreshTree]);

  const [hover, setHover] = useState(-1);
  const [anchorTurn, setAnchorTurn] = useState(-1);
  // 阅读锚点：只用来在长对话里让当前轮次的刻度留在可见区（**不做视觉高亮**，常态所有刻度一样）。
  // 订阅即回放现值 ⇒ 兄弟组件 effect 挂载顺序不再影响首帧。
  const railRef = useRef<HTMLUListElement | null>(null);
  const tickRefs = useRef(new Map<number, HTMLButtonElement>());
  useEffect(
    () =>
      subscribeOutlineAnchor((itemId) => {
        const idx = itemId ? ticks.findIndex((t) => t.rowId === itemId) : -1;
        setAnchorTurn(idx >= 0 ? ticks[idx].turnIndex : -1);
      }),
    [ticks],
  );
  useEffect(() => {
    if (anchorTurn < 0) return;
    const rail = railRef.current;
    const el = tickRefs.current.get(anchorTurn);
    if (!rail || !el) return; // 只在刻度条自身溢出时跟随，够得着就不动
    if (rail.scrollHeight <= rail.clientHeight) return;
    const top = el.offsetTop - rail.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < rail.scrollTop) rail.scrollTop = top;
    else if (bottom > rail.scrollTop + rail.clientHeight) rail.scrollTop = bottom - rail.clientHeight;
  }, [anchorTurn, ticks.length]);

  // ── hover 动画：GSAP 命令式驱动，React 只管摘要浮层内容 ──────────────────
  // 旧实现把 tickWidthAt 写进 inline style.width + CSS transition：每次 hover 变化
  // 整列刻度重渲染，且 width 是布局属性——逐帧 reflow，多根同动就是「卡」的根源。
  // GSAP 姿势：刻度线固定 16px 基准宽，只动 transform.scaleX（合成层，零 reflow）；
  // 颜色「变亮」用前景色叠加层的 opacity 代替 color-mix 背景色（opacity 同样走合成）。
  const lineRefs = useRef(new Map<number, HTMLSpanElement>());
  const hlRefs = useRef(new Map<number, HTMLSpanElement>());
  const applyHover = useCallback((h: number): void => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const duration = reduce ? 0 : 0.25;
    for (const [i, line] of lineRefs.current) {
      const width = tickWidthAt(i, h, TICK_BASE, TICK_MAX, SIGMA);
      const hl = hlRefs.current.get(i);
      gsap.to(line, { scaleX: width / TICK_BASE, duration, ease: "power3.out", overwrite: "auto" });
      if (hl) {
        gsap.to(hl, {
          autoAlpha: (width - TICK_BASE) / (TICK_MAX - TICK_BASE),
          duration,
          ease: "power2.out",
          overwrite: "auto",
        });
      }
    }
  }, []);
  // 刻度集合变化（新轮次/切对话）：全部回常态并清掉在途 tween
  useEffect(() => {
    for (const el of lineRefs.current.values()) gsap.set(el, { scaleX: 1 });
    for (const el of hlRefs.current.values()) gsap.set(el, { autoAlpha: 0 });
  }, [ticks.length]);
  useEffect(() => {
    const lines = lineRefs.current;
    const hls = hlRefs.current;
    return () => {
      for (const el of lines.values()) gsap.killTweensOf(el);
      for (const el of hls.values()) gsap.killTweensOf(el);
    };
  }, []);

  // 摘要浮层跟随被 hover 的那一根：按实测行中心定位（刻度条内部滚动/居中偏移都不用换算常量）。
  const railBoxRef = useRef<HTMLDivElement | null>(null);
  const [tipTop, setTipTop] = useState(0);
  const showTipFor = useCallback(
    (index: number, el: HTMLElement): void => {
      setHover(index);
      applyHover(index); // 动画走 GSAP ticker，不等 React 重渲染
      const box = railBoxRef.current?.getBoundingClientRect();
      const row = el.getBoundingClientRect();
      if (box) setTipTop(row.top - box.top + row.height / 2);
    },
    [applyHover],
  );

  // 沿刻度条平移时不闪断：离开 120ms 后才收（期间移到相邻刻度会立刻续上）。
  const closeTimer = useRef<number | null>(null);
  const keepTip = useCallback((): void => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const scheduleHide = useCallback((): void => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setHover(-1);
      applyHover(-1);
      closeTimer.current = null;
    }, TIP_CLOSE_DELAY);
  }, [applyHover]);
  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const jump = useCallback((rowId: string): void => {
    setHover(-1);
    applyHover(-1);
    window.dispatchEvent(new CustomEvent("piwood:outline-jump", { detail: { itemId: rowId } }));
  }, [applyHover]);

  // 窄窗隐藏：观察自己所在的消息列容器（offsetParent）宽度。
  // ⚠ 必须用 callback ref 而不是 useEffect([])：消息 <2 条时组件返回 null，effect 首跑没有 DOM，
  //   之后元素出现也不会重挂 observer（v2.1 带窗探针 U5 首捕这个坑）。
  const roRef = useRef<ResizeObserver | null>(null);
  const [narrow, setNarrow] = useState(false);
  const attachHost = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    const host = el?.parentElement;
    if (!host) return;
    const check = (w: number): void => setNarrow(w < CONTEXT_TREE_MIN_CENTER_WIDTH);
    check(host.clientWidth);
    const ro = new ResizeObserver((entries) => check(Math.round(entries[0]?.contentRect.width ?? host.clientWidth)));
    ro.observe(host);
    roRef.current = ro;
  }, []);
  useEffect(() => () => roRef.current?.disconnect(), []);

  if (ticks.length < 2) return null; // 消息太少没有导航价值（参考 messages.length > 1，也避免盖住空态）

  const hovered = hover >= 0 ? ticks[hover] : undefined;

  return (
    <div
      ref={attachHost}
      data-minimap
      aria-label="消息刻度导航"
      className={cn("pointer-events-none absolute left-2 top-1/2 z-20 -translate-y-1/2", narrow && "invisible")}
    >
      <div ref={railBoxRef} className="pointer-events-auto relative">
        {/* 刻度条：常态每根完全一样（16×1px、同色）；hover 才以目标为中心做正态展开；轮次过多内部滚动不留滚动条 */}
        <ul
          ref={railRef}
          data-message-nav="compact"
          role="list"
          className="flex list-none flex-col items-start overflow-y-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ width: RAIL_WIDTH, maxHeight: RAIL_MAX_HEIGHT }}
        >
          {ticks.map((t, i) => (
            <li key={t.rowId} data-nav-item className="flex items-center self-stretch" style={{ height: RAIL_ROW_HEIGHT }}>
              <button
                type="button"
                data-tick
                data-tick-kind={t.kind}
                ref={(el) => {
                  if (el) tickRefs.current.set(i, el);
                  else tickRefs.current.delete(i);
                }}
                aria-label={`跳转到${t.kind === "user" ? "提问" : "回复"}：${t.title}`}
                onMouseEnter={(e) => {
                  keepTip();
                  showTipFor(i, e.currentTarget);
                }}
                onMouseLeave={scheduleHide}
                onFocus={(e) => showTipFor(i, e.currentTarget)}
                onBlur={scheduleHide}
                onClick={() => jump(t.rowId)}
                className="flex cursor-pointer items-center justify-start border-0 bg-transparent p-0"
                style={{ width: RAIL_WIDTH, height: RAIL_ROW_HEIGHT }}
              >
                {/* 基准宽固定（问/答等长），hover 只动 scaleX（合成层）；
                    高亮 = 前景叠加层的 opacity（代替 color-mix，同样零 reflow） */}
                <span
                  ref={(el) => {
                    if (el) lineRefs.current.set(i, el);
                    else lineRefs.current.delete(i);
                  }}
                  aria-hidden
                  data-tick-line
                  className="relative block h-px rounded-[1px]"
                  style={{ width: TICK_BASE, transformOrigin: "left center" }}
                >
                  <span
                    className={cn(
                      "absolute inset-0 rounded-[1px] bg-muted-foreground",
                      t.kind === "assistant" && "opacity-60",
                    )}
                  />
                  <span
                    ref={(el) => {
                      if (el) hlRefs.current.set(i, el);
                      else hlRefs.current.delete(i);
                    }}
                    data-tick-hl
                    className="absolute inset-0 rounded-[1px] bg-foreground invisible"
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>

        {/* 摘要浮层：只出当前 hover 的这一条，不列其他轮次 */}
        {hovered && (
          <div
            data-nav-tip
            aria-hidden
            className="pointer-events-none absolute z-30 flex max-w-[min(24rem,38vw)] -translate-y-1/2 items-center gap-2.5 whitespace-nowrap rounded-md border border-border/60 bg-popover/95 px-2.5 py-1 text-sm text-popover-foreground shadow-md"
            style={{ left: RAIL_WIDTH + TIP_GUTTER, top: tipTop }}
          >
            <span data-title-preview className="min-w-0 truncate">
              <span className={cn("mr-1.5 text-xs", hovered.kind === "user" ? "text-primary" : "text-muted-foreground")}>
                {hovered.kind === "user" ? "问" : "答"}
              </span>
              {hovered.title || "新消息"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
