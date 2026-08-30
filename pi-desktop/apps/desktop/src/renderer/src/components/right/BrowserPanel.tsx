import { useEffect, useRef, useState } from "react";

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
    <div className="browser-panel">
      <div className="browser-bar">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void go()}
        />
        <button onClick={() => void go()}>前往</button>
      </div>
      <div className="muted browser-status">{status}</div>
      {shot && <img className="browser-shot" src={shot} alt="页面截图" />}
    </div>
  );
}
