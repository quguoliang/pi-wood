import { useEffect, useState } from "react";

declare global {
  interface Window {
    pi: { ping(): Promise<{ pong: boolean; electron: string; node: string }> };
  }
}

export default function App() {
  const [versions, setVersions] = useState<{ electron: string; node: string } | null>(null);

  useEffect(() => {
    window.pi
      .ping()
      .then((r) => setVersions({ electron: r.electron, node: r.node }))
      .catch(() => setVersions(null));
  }, []);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <strong>PiDesk</strong>
        <span className="muted">T0.1 骨架 · 三栏占位</span>
      </header>
      <div className="panels">
        <aside className="panel left">
          <h2>左栏</h2>
          <p className="muted">项目 / 会话树 / 历史（T1.4）</p>
        </aside>
        <section className="panel center">
          <h2>中栏</h2>
          <p className="muted">对话流 / 工具卡片 / 输入（T1.3）</p>
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
    </div>
  );
}
