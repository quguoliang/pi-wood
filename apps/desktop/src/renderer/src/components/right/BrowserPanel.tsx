import { useCallback, useEffect, useRef, useState } from "react";
import type { DevServerInfo } from "@pi-wood/ipc-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "../ui/Icon";

/** T2.4 浏览器面板：地址栏 + 截图流（headless，agent 经 browser_* 工具共用同一页面）。T7.4 增「发现的本地 dev server」快捷预览。 */
export function BrowserPanel(): React.JSX.Element {
  const [url, setUrl] = useState("https://example.com");
  const [shot, setShot] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState("");
  const [devServers, setDevServers] = useState<DevServerInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const busy = useRef(false);

  const go = async (target?: string): Promise<void> => {
    const u = (target ?? url).trim();
    if (!u || busy.current) return;
    busy.current = true;
    setStatus("加载中…");
    try {
      const full = /^https?:\/\//.test(u) ? u : `https://${u}`;
      const { title } = await window.pi.browserNavigate(full);
      setUrl(full);
      const { screenshot } = await window.pi.browserScreenshot();
      setShot(`data:image/png;base64,${screenshot}`);
      setStatus(title);
    } catch (err) {
      setStatus(String((err as Error)?.message ?? err));
    } finally {
      busy.current = false;
    }
  };

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
    void go();
    void scanDevServers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void go()}
        />
        <Button size="sm" variant="ghost" onClick={() => void go()}>前往</Button>
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
            onClick={() => void go(s.url)}
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
      <div className="px-2 py-1 text-xs text-muted-foreground">{status}</div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {shot && <img className="w-full rounded-lg border border-border" src={shot} alt="页面截图" />}
      </div>
    </div>
  );
}
