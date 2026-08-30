import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    pi: {
      ping(): Promise<{ pong: boolean; electron: string; node: string }>;
      onUiNotify(cb: (data: { message: string; type: string }) => void): () => void;
      onProbeLog(cb: (line: string) => void): () => void;
      onEngineEvent(cb: (event: Record<string, unknown>) => void): () => void;
      onDiff(cb: (data: { file: string; patch: string }) => void): () => void;
      onE2EDone(cb: (data: { ok: boolean; error?: string }) => void): () => void;
      prompt(text: string): Promise<void>;
    };
  }
}

interface Toast {
  id: number;
  message: string;
  type: string;
}

interface ToolCard {
  id: string;
  toolName: string;
  status: "running" | "ok" | "error";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function App() {
  const [versions, setVersions] = useState<{ electron: string; node: string } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [probeLogs, setProbeLogs] = useState<string[]>([]);
  const [assistantText, setAssistantText] = useState("");
  const [toolCards, setToolCards] = useState<ToolCard[]>([]);
  const [diffs, setDiffs] = useState<Array<{ file: string; patch: string }>>([]);
  const [e2eState, setE2EState] = useState<"idle" | "running" | "pass" | "fail">("idle");
  const [input, setInput] = useState("");
  const idSeq = useRef(0);

  useEffect(() => {
    window.pi
      .ping()
      .then((r) => setVersions({ electron: r.electron, node: r.node }))
      .catch(() => setVersions(null));

    const offNotify = window.pi.onUiNotify((data) => {
      const id = ++idSeq.current;
      setToasts((t) => [...t, { id, message: data.message, type: data.type }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
    });
    const offLog = window.pi.onProbeLog((line) => setProbeLogs((l) => [...l, line]));
    const offEvt = window.pi.onEngineEvent((event: any) => {
      const type = event.type as string;
      if (type === "agent_start" || type === "turn_start") setE2EState((s) => (s === "idle" ? "running" : s));
      if (type === "message_update") {
        const inner = event.assistantMessageEvent as any;
        if (inner?.type === "text_delta" && typeof inner.delta === "string") {
          setAssistantText((prev) => prev + inner.delta);
        } else if (typeof inner?.text === "string" && inner.type === "text_delta") {
          setAssistantText((prev) => prev + inner.text);
        }
      }
      if (type === "tool_execution_start") {
        setToolCards((c) => [
          ...c,
          { id: String(event.toolCallId ?? Date.now()), toolName: event.toolName as string, status: "running" },
        ]);
      }
      if (type === "tool_execution_end") {
        setToolCards((c) =>
          c.map((card) =>
            card.id === String(event.toolCallId)
              ? { ...card, status: event.isError ? "error" : "ok" }
              : card,
          ),
        );
      }
      if (type === "agent_end") setE2EState((s) => (s === "running" ? "idle" : s));
    });
    const offDiff = window.pi.onDiff((data) => setDiffs((d) => [...d, data]));
    const offDone = window.pi.onE2EDone((data) => setE2EState(data.ok ? "pass" : "fail"));
    return () => {
      offNotify();
      offLog();
      offEvt();
      offDiff();
      offDone();
    };
  }, []);

  const sendPrompt = (): void => {
    if (!input.trim()) return;
    setAssistantText("");
    void window.pi.prompt(input.trim());
    setInput("");
  };

  return (
    <div className="app-shell">
      <header className="top-bar">
        <strong>PiDesk</strong>
        <span className="muted">T0.6 门禁 E2E · 工具卡片 + diff 上屏</span>
        <span className={`badge badge-${e2eState}`}>{e2eState}</span>
      </header>
      <div className="panels">
        <aside className="panel left">
          <h2>左栏</h2>
          <p className="muted">项目 / 会话树 / 历史（T1.4）</p>
        </aside>
        <section className="panel center">
          <h2>中栏 · 对话流</h2>
          {toolCards.length > 0 && (
            <div className="tool-cards">
              {toolCards.map((card) => (
                <div key={card.id} className={`tool-card tool-${card.status}`}>
                  <span className="tool-icon">{card.status === "running" ? "⏳" : card.status === "ok" ? "✅" : "❌"}</span>
                  <b>{card.toolName}</b>
                  <span className="muted">{card.status}</span>
                </div>
              ))}
            </div>
          )}
          {assistantText && <div className="assistant-text">{assistantText}</div>}
          {probeLogs.length > 0 && (
            <div className="probe-box">
              {probeLogs.map((line, i) => (
                <div key={i} className={line.includes("ERROR") ? "err" : ""}>
                  {line}
                </div>
              ))}
            </div>
          )}
          <div className="composer">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入 prompt（T1.3 正式化）"
              rows={2}
            />
            <button onClick={sendPrompt}>发送</button>
          </div>
        </section>
        <aside className="panel right">
          <h2>右栏 · Diff（T2.2 正式化）</h2>
          {diffs.length === 0 && <p className="muted">等待文件变更…</p>}
          {diffs.map((d) => (
            <div key={d.file} className="diff-box">
              <div className="diff-file">{d.file}</div>
              <pre>{d.patch}</pre>
            </div>
          ))}
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
