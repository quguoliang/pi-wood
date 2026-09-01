import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** T2.4 浏览器面板：地址栏 + 截图流（headless，agent 经 browser_* 工具共用同一页面） */
export function BrowserPanel(): React.JSX.Element {
  const [url, setUrl] = useState("https://example.com");
  const [shot, setShot] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState("");
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

  useEffect(() => {
    void go();
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
      <div className="px-2 py-1 text-xs text-muted-foreground">{status}</div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {shot && <img className="w-full rounded-lg border border-border" src={shot} alt="页面截图" />}
      </div>
    </div>
  );
}
