import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useActiveConversation, useSessionStore } from "../../stores/session-store";
import { useConversationsStore } from "../../stores/conversations-store";
import { useContextTreeStore } from "../../stores/context-tree-store";

/**
 * T9.2 v2.1 MessageMinimap：消息列左缘的竖向刻度条（取代原 w-56 常驻侧栏——用户改判：
 * 「缩略导航不该单独弄侧栏，浮在左边、小横杠代表每条消息」）。
 *
 * 交互（对齐参考形态）：
 * - 每条 user/assistant 消息一个刻度；**常态全部等长**（14px），工具/思考/系统不成刻度；
 * - hover：以目标为中心做正态分布式的横向重排（目标最长 30px、相邻按高斯衰减渐长，150ms ease），
 *   同时右侧浮出「角色 + 首行摘要」tooltip；
 * - 点击：派发 `piwood:outline-jump`（MessageList 既有监听：scrollToIndex + 行高亮），平滑滚到目标；
 * - 当前阅读区域高亮：跟随 MessageList scroll-spy 派发的 `piwood:outline-active`（user 行锚点），
 *   该轮（锚点 user + 其后的 assistant）刻度点亮；
 * - 对话更新自动重建（items 派生）；宿主容器 <720px 自动隐藏（浮层不遮正文）；
 * - 顺带承担轮末刷会话树（fork 的「行 ↔ 会话树条目」序号对齐依赖树数据新鲜）。
 *
 * 颜色全走主题 token（foreground/muted-foreground/primary），浅暗色自动适配。
 */

const TICK_BASE = 14;
const TICK_MAX = 30;
const SIGMA = 1.6;
const MIN_HOST_WIDTH = 720;

interface Tick {
  rowId: string;
  kind: "user" | "assistant";
  title: string;
  turnIndex: number;
}

function firstLine(text: string): string {
  const line =
    text
      .trim()
      .split("\n", 1)[0]
      ?.replace(/^#{1,6}\s+/, "")
      .replace(/[*`>]+/g, "")
      .replace(/\s+/g, " ")
      .trim() ?? "";
  if (!line) return "(空消息)";
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

export function MessageMinimap(): React.JSX.Element | null {
  const items = useActiveConversation((c) => c.items);
  const streaming = useActiveConversation((c) => c.streaming);
  const activeConversationId = useSessionStore((s) => s.activeConversationId);
  const sessionFile = useConversationsStore((s) => s.rows.find((r) => r.id === activeConversationId)?.sessionFile);
  const refreshTree = useContextTreeStore((s) => s.refresh);

  const ticks = useMemo<Tick[]>(() => {
    const out: Tick[] = [];
    let turn = -1;
    for (const it of items) {
      if (it.kind === "user") {
        turn += 1;
        out.push({ rowId: it.id, kind: "user", title: firstLine(it.text), turnIndex: turn });
      } else if (it.kind === "assistant") {
        out.push({ rowId: it.id, kind: "assistant", title: firstLine(it.text), turnIndex: turn });
      }
    }
    return out;
  }, [items]);

  // 会话树刷新：切对话/会话文件变化刷一次，轮末（streaming true→false）强刷一次。
  // 树数据供消息级「分叉」做 行↔条目 序号对齐（fork 需要 user 条目的 entry id）。
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
  useEffect(() => {
    const onActive = (e: Event): void => {
      const id = (e as CustomEvent<{ itemId?: string }>).detail?.itemId;
      const idx = id ? ticks.findIndex((t) => t.rowId === id) : -1;
      setAnchorTurn(idx >= 0 ? ticks[idx].turnIndex : -1);
    };
    window.addEventListener("piwood:outline-active", onActive);
    return () => window.removeEventListener("piwood:outline-active", onActive);
  }, [ticks]);

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
    const check = (w: number): void => setNarrow(w < MIN_HOST_WIDTH);
    check(host.clientWidth);
    const ro = new ResizeObserver((entries) => check(Math.round(entries[0]?.contentRect.width ?? host.clientWidth)));
    ro.observe(host);
    roRef.current = ro;
  }, []);
  useEffect(() => () => roRef.current?.disconnect(), []);

  if (ticks.length < 2) return null; // 消息太少没有导航价值（也避免盖住空态）

  const widthAt = (i: number): number => {
    if (hover < 0) return TICK_BASE;
    const d = i - hover;
    return TICK_BASE + (TICK_MAX - TICK_BASE) * Math.exp(-(d * d) / (2 * SIGMA * SIGMA));
  };

  return (
    <div
      ref={attachHost}
      data-minimap
      aria-label="消息刻度导航"
      className={cn("pointer-events-none absolute left-1 top-1/2 z-20 -translate-y-1/2", narrow && "invisible")}
    >
      <div className="pointer-events-auto flex flex-col items-start gap-[6px] py-2">
        {ticks.map((t, i) => {
          const inTurn = anchorTurn >= 0 && t.turnIndex === anchorTurn;
          return (
            <div
              key={t.rowId}
              className="relative flex items-center"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? -1 : h))}
            >
              <button
                type="button"
                aria-label={`跳转到消息：${t.title}`}
                onClick={() => window.dispatchEvent(new CustomEvent("piwood:outline-jump", { detail: { itemId: t.rowId } }))}
                style={{ width: Math.round(widthAt(i)) }}
                className={cn(
                  "h-[3px] shrink-0 cursor-pointer rounded-full transition-[width,background-color] duration-150 ease-out",
                  hover === i ? "bg-foreground/70" : inTurn ? "bg-primary/70" : "bg-muted-foreground/35 hover:bg-muted-foreground/60",
                )}
              />
              {hover === i && (
                <span className="pointer-events-none absolute left-6 top-1/2 z-30 flex max-w-[min(24rem,38vw)] -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-md border border-border/60 bg-popover/95 px-2 py-1 text-[11px] text-popover-foreground shadow-md">
                  <span className={cn("shrink-0 font-medium", t.kind === "user" ? "text-primary" : "text-muted-foreground")}>
                    {t.kind === "user" ? "我" : "助手"}
                  </span>
                  <span className="min-w-0 truncate">{t.title}</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
