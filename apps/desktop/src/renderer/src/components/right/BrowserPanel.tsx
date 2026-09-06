import { useCallback, useEffect, useRef, useState } from "react";
import type { DevServerInfo } from "@pi-wood/ipc-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "../ui/Icon";

/**
 * 浏览器面板（T2.4 截图流 → 真·内嵌浏览器重构）：
 * - <webview> 渲染真实页面：可点击/输入/滚动/登录（persist 分区，登录态跨会话保留）；
 * - 本地 dev server 快捷预览（T7.4）直达，不再绕道 headless playwright——此前 localhost
 *   预览还会因 goto 8s 超时直接报错；
 * - agent 的 browser_* 工具仍走 workbench/browser-service 的 headless 页，与本面板互不影响。
 * webview 事件不走 React props，统一挂 DOM listener；地址栏输入与 webview src 解耦（敲字不导航）。
 */
interface WebviewEl extends HTMLElement {
  src: string;
  goBack(): void;
  goForward(): void;
  reload(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
}

const HOME_URL = "https://example.com";

export function BrowserPanel(): React.JSX.Element {
  const [url, setUrl] = useState(HOME_URL);
  // 真正喂给 webview src 的地址；回车/前往/点本地服务才更新
  const [navUrl, setNavUrl] = useState(HOME_URL);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [devServers, setDevServers] = useState<DevServerInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const viewRef = useRef<WebviewEl | null>(null);

  const go = useCallback((target?: string): void => {
    const u = (target ?? url).trim();
    if (!u) return;
    const full = /^https?:\/\//.test(u) ? u : `https://${u}`;
    setUrl(full);
    setStatus("加载中…");
    setLoading(true);
    setNavUrl(full);
  }, [url]);

  const scanDevServers = useCallback(async (): Promise<void> => {
    setScanning(true);
    try {
      setDevServers(await window.pi.listDevServers());
    } catch {
      /* 检测失败保持空列表 */
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void scanDevServers();
  }, [scanDevServers]);

  // webview 生命周期：地址栏跟随真实导航、标题/失败进状态条
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const onDidNavigate = (e: Event): void => {
      setUrl((e as unknown as { url?: string }).url ?? v.src);
      setStatus("");
    };
    const onInPage = (e: Event): void => {
      if ((e as unknown as { isMainFrame?: boolean }).isMainFrame !== false) setUrl(v.src);
    };
    const onTitle = (e: Event): void => {
      const t = (e as unknown as { title?: string }).title;
      if (t) setStatus(t);
    };
    const onStart = (): void => setLoading(true);
    const onStop = (): void => {
      setLoading(false);
      setStatus((s) => (s === "加载中…" ? "" : s));
    };
    const onFail = (e: Event): void => {
      const { code, errorDescription, isMainFrame } = e as unknown as { code: number; errorDescription: string; isMainFrame?: boolean };
      if (code === -3 || isMainFrame === false) return; // -3=新导航打断；子帧失败不吵用户
      setLoading(false);
      setStatus(`加载失败 (${code}): ${errorDescription}`);
    };
    const listeners = [
      ["did-navigate", onDidNavigate],
      ["did-navigate-in-page", onInPage],
      ["page-title-updated", onTitle],
      ["did-start-loading", onStart],
      ["did-stop-loading", onStop],
      ["did-fail-load", onFail],
    ] as const;
    for (const [name, fn] of listeners) v.addEventListener(name, fn);
    return () => {
      for (const [name, fn] of listeners) v.removeEventListener(name, fn);
    };
  }, []);

  const back = (): void => viewRef.current?.goBack();
  const forward = (): void => viewRef.current?.goForward();
  const reload = (): void => {
    setStatus("加载中…");
    setLoading(true);
    viewRef.current?.reload();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 shrink-0 px-1.5 text-muted-foreground hover:text-foreground"
          onClick={back}
          aria-label="后退"
        >
          <Icon name="arrowLeft" className="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 shrink-0 px-1.5 text-muted-foreground hover:text-foreground"
          onClick={forward}
          aria-label="前进"
        >
          <Icon name="arrowRight" className="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 shrink-0 px-1.5 text-muted-foreground hover:text-foreground"
          onClick={reload}
          aria-label="刷新"
        >
          <Icon name={loading ? "spinner" : "refresh"} className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
        </Button>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          className="font-mono text-xs"
        />
        <Button size="sm" variant="ghost" onClick={() => go()}>前往</Button>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border/60 px-2 py-1.5">
        <span className="shrink-0 text-[11px] text-muted-foreground">本地服务</span>
        {devServers.length === 0 && (
          <span className="text-[11px] text-muted-foreground/70">{scanning ? "扫描中…" : "未发现运行中的 dev server"}</span>
        )}
        {devServers.map((s) => (
          <button
            key={s.port}
            type="button"
            onClick={() => go(s.url)}
            title={`${s.url}${s.command ? ` · ${s.command}` : ""}${s.pid ? ` (pid ${s.pid})` : ""}`}
            className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-foreground transition-[transform,background-color,border-color] motion-safe:hover:border-primary/50 motion-safe:hover:bg-muted motion-safe:active:scale-[0.97]"
          >
            <Icon name="browser" className="size-3 text-muted-foreground" />
            <span className="font-mono">:{s.port}</span>
            {s.command && <span className="max-w-24 truncate text-muted-foreground">{s.command}</span>}
          </button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-6 shrink-0 px-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => void scanDevServers()}
          aria-label="重新扫描本地服务"
        >
          <Icon name={scanning ? "spinner" : "play"} className={scanning ? "size-3.5 animate-spin" : "size-3.5"} />
        </Button>
      </div>
      <div className="flex h-6 shrink-0 items-center px-2 text-xs text-muted-foreground">
        <span className="truncate">{status}</span>
      </div>
      <webview ref={viewRef} src={navUrl} partition="persist:piwood-browser" className="min-h-0 flex-1" style={{ display: "flex", flex: 1 }} />
    </div>
  );
}
