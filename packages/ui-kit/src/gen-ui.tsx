import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./cn";
import { GEN_UI_SANDBOX_ATTR, buildGenUiSrcDoc } from "./gen-ui-core";

/**
 * T11.1 生成式 UI 正文渲染块（纯逻辑见 ./gen-ui-core.ts）。
 *
 * 模型的 ```` ```genui ```` 围栏内容是一段**自包含 HTML**。本组件把它放进
 * `<iframe sandbox="allow-scripts">`（**刻意不给 allow-same-origin**）里渲染——
 * 于是脚本运行在不透明源（opaque origin）下：
 * - 读不到宿主页面的 DOM / localStorage / cookie；
 * - 跳转顶层窗口、开弹窗、下载均被 sandbox 默认策略拦住；
 * - `parent.postMessage` 仍可用（跨源消息合法），这是唯一的回传通道。
 *
 * 宿主侧只认两件事：`piwood-genui-height`（自动高度）与 `piwood-genui-prompt`（把一句话发回对话）。
 * 后者经 `window.pi.engineFollowUp` 落地——与用户手打一句话等价，不引入新的执行面。
 *
 * 主题令牌：iframe 是独立文档，宿主的 CSS 变量不会级联进去，故每次挂载/主题变更时
 * 从 `document.documentElement` 读一次计算值，把 `--color-*` 与同名短变量注进去，
 * 这样模型只写 `var(--color-card)` 就能同时适配深/浅色。
 */

/**
 * 高度上下限。上限防「模型写了个撑满视口的容器」把消息流撑爆；下限防空块塌成一条线。
 * 首帧用 DEFAULT_HEIGHT 兜底，沙箱测出真实高度后立刻替换（见 gen-ui-core 的运行时）。
 */
const MIN_HEIGHT = 40;
const MAX_HEIGHT = 6000;
const DEFAULT_HEIGHT = 220;

export type GenUiBlockProps = {
  code: string;
  className?: string;
};

export const GenUiBlock = memo(function GenUiBlock({ code, className }: GenUiBlockProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [showSource, setShowSource] = useState(false);
  // 主题切换（data-theme 属性 / glass class）时重算令牌 —— iframe 内的变量是快照
  const [themeEpoch, setThemeEpoch] = useState(0);
  const [runtimeError, setRuntimeError] = useState<string | undefined>();

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setThemeEpoch((n) => n + 1));
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const frame = frameRef.current;
      // 只认自己这个 iframe 的消息（同一页面可能同时挂多个 GenUI 块）
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown; text?: unknown } | null;
      if (!data || typeof data.type !== "string") return;
      if (data.type === "piwood-genui-height" && typeof data.height === "number" && Number.isFinite(data.height)) {
        setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.ceil(data.height))));
        return;
      }
      if (data.type === "piwood-genui-prompt" && typeof data.text === "string" && data.text.trim()) {
        const pi = (window as unknown as { pi?: { engineFollowUp?: (text: string) => Promise<unknown> } }).pi;
        if (typeof pi?.engineFollowUp !== "function") {
          setRuntimeError("当前构建未注入对话发送能力，沙箱内交互不可用");
          return;
        }
        void Promise.resolve(pi.engineFollowUp(data.text.trim())).catch(() => {
          setRuntimeError("发送失败：请确认当前有可用的对话");
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const srcDoc = useMemo(() => buildGenUiSrcDoc(code), [code, themeEpoch]);

  if (!code.trim()) return null;

  return (
    <div className={cn("my-3 flex w-full max-w-full flex-col overflow-hidden rounded-lg border border-border bg-card/40", className)}>
      <div className="flex items-center gap-2 border-b border-border/70 bg-muted/40 px-2.5 py-1">
        <span className="shrink-0 text-[11px] font-medium tracking-wide text-muted-foreground">生成式 UI</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/60">
          {runtimeError ?? "沙箱渲染 · 只读宿主设计令牌 · 交互仅限发回对话"}
        </span>
        <button
          type="button"
          onClick={() => setShowSource((v) => !v)}
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {showSource ? "预览" : "源码"}
        </button>
      </div>
      {showSource ? (
        <pre className="m-0 max-h-[420px] overflow-auto p-3 font-mono text-[11.5px] leading-[1.6] text-muted-foreground">{code}</pre>
      ) : (
        <iframe
          ref={frameRef}
          title="生成式 UI"
          sandbox={GEN_UI_SANDBOX_ATTR}
          srcDoc={srcDoc}
          className="w-full border-0 bg-transparent"
          style={{ height }}
        />
      )}
    </div>
  );
});
