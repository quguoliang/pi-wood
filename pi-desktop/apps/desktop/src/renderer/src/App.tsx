import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    pi: {
      ping(): Promise<{ pong: boolean; electron: string; node: string }>;
      onUiNotify(cb: (data: { message: string; type: string }) => void): () => void;
      onProbeLog(cb: (line: string) => void): () => void;
    };
  }
}

interface Toast {
  id: number;
  message: string;
  type: string;
}

export default function App() {
  const [versions, setVersions] = useState<{ electron: string; node: string } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [probeLogs, setProbeLogs] = useState<string[]>([]);
  const toastId = useRef(0);

  useEffect(() => {
    window.pi
      .ping()
      .then((r) => setVersions({ electron: r.electron, node: r.node }))
      .catch(() => setVersions(null));

    const offNotify = window.pi.onUiNotify((data) => {
      const id = ++toastId.current;
      setToasts((t) => [...t, { id, message: data.message, type: data.type }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
    });
    const offLog = window.pi.onProbeLog((line) => setProbeLogs((l) => [...l, line]));
    return () => {
      offNotify();
      offLog();
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <strong>PiDesk</strong>
        <span className="muted">T0.1 骨架 · T0.3 扩展桥验证</span>
      </header>
      <div className="panels">
        <aside className="panel left">
          <h2>左栏</h2>
          <p className="muted">项目 / 会话树 / 历史（T1.4）</p>
        </aside>
        <section className="panel center">
          <h2>中栏</h2>
          <p className="muted">对话流 / 工具卡片 / 输入（T1.3）</p>
          {probeLogs.length > 0 && (
            <div className="probe-box">
              {probeLogs.map((line, i) => (
                <div key={i} className={line.includes("ERROR") ? "err" : ""}>
                  {line}
                </div>
              ))}
            </div>
          )}
        </section>
        <aside className="panel right">
          <h2>右栏</h2>
          <p className="muted">工作台：浏览器 / 终端 / 文件 / 代码 / diff（T2.x）</p>
        </aside>
      </div>
      <footer className="status-bar">
        {versions
          ? `IPC ✅ · electron ${versions.electron} · node ${versions.node}`
          : "IPC 检测中…"}
      </footer>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
