import { useEffect, useRef, useState } from "react";
import { AppShell } from "./components/layout/AppShell";

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
      settingsGet(): Promise<Record<string, unknown>>;
      settingsSet(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
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
      if (event.type === "message_update") {
        const inner = event.assistantMessageEvent as any;
        const delta = inner?.type === "text_delta" ? (inner.delta ?? inner.text) : undefined;
        if (typeof delta === "string") setAssistantText((prev) => prev + delta);
      }
      if (event.type === "tool_execution_start") {
        setToolCards((c) => [
          ...c,
          { id: String(event.toolCallId ?? Date.now()), toolName: event.toolName as string, status: "running" },
        ]);
      }
      if (event.type === "tool_execution_end") {
        setToolCards((c) =>
          c.map((card) =>
            card.id === String(event.toolCallId)
              ? { ...card, status: event.isError ? "error" : "ok" }
              : card,
          ),
        );
      }
    });
    const offDiff = window.pi.onDiff((data) => setDiffs((d) => [...d, data]));
    return () => {
      offNotify();
      offLog();
      offEvt();
      offDiff();
    };
  }, []);

  const sendPrompt = (): void => {
    if (!input.trim()) return;
    setAssistantText("");
    void window.pi.prompt(input.trim());
    setInput("");
  };

  return (
    <AppShell
      left={
        <>
          <h2>左栏</h2>
          <p className="muted">项目 / 会话树 / 历史（T1.4 UI）</p>
        </>
      }
      center={
        <>
          {toolCards.length > 0 && (
            <div className="tool-cards">
              {toolCards.map((card) => (
                <div key={card.id} className={`tool-card tool-${card.status}`}>
                  <span className="tool-icon">
                    {card.status === "running" ? "⏳" : card.status === "ok" ? "✅" : "❌"}
                  </span>
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
        </>
      }
      right={
        <>
          <h2>右栏 · 工作台</h2>
          <p className="muted">dockview 停靠布局在 T2.5 挂载</p>
          {diffs.map((d) => (
            <div key={d.file} className="diff-box">
              <div className="diff-file">{d.file}</div>
              <pre>{d.patch}</pre>
            </div>
          ))}
        </>
      }
      statusbar={
        versions
          ? `IPC ✅ · electron ${versions.electron} · node ${versions.node} · 模型/上下文占用在 T1.3 接真实数据`
          : "IPC 检测中…"
      }
    />
  );
}
