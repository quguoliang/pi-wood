import { useEffect, useRef, useState } from "react";
import { AppShell } from "./components/layout/AppShell";
import { MessageList } from "./components/center/MessageList";
import { Composer } from "./components/center/Composer";
import { ApprovalCards } from "./components/center/ApprovalCards";
import { SettingsModal } from "./components/center/SettingsModal";
import { CommandPalette } from "./components/center/CommandPalette";
import { LeftPane } from "./components/left/LeftPane";
import { RightPane } from "./components/right/RightPane";
import { useSessionStore } from "./stores/session-store";

interface Toast {
  id: number;
  message: string;
  type: string;
}

export default function App() {
  const [versions, setVersions] = useState<{ electron: string; node: string } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [diffs, setDiffs] = useState<Array<{ file: string; before?: string; after?: string; patch?: string }>>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [modelName, setModelName] = useState("");
  const idSeq = useRef(0);
  const handleEvent = useSessionStore((s) => s.handleEvent);

  useEffect(() => {
    window.pi
      .ping()
      .then((r) => setVersions({ electron: r.electron, node: r.node }))
      .catch(() => setVersions(null));

    // 主题（T3.3）：settings.theme.fallback → <html data-theme>
    void window.pi.settingsGet().then((s) => {
      const t = (s as { theme?: { fallback?: string } }).theme?.fallback;
      if (t) document.documentElement.dataset.theme = t;
    });

    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    const pushToast = (message: string, type: string): void => {
      const id = ++idSeq.current;
      setToasts((t) => [...t, { id, message, type }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
    };

    const offNotify = window.pi.onUiNotify((d) => pushToast(d.message, d.type));
    const offEvt = window.pi.onEngineEvent((event) => {
      handleEvent(event);
      if (event.type === "model_changed") {
        const m = event as unknown as { provider: string; id: string };
        setModelName(`${m.provider}/${m.id}`);
      }
    });
    const offDiff = window.pi.onDiff((data) => setDiffs((d) => [...d, data]));
    return () => {
      offNotify();
      offEvt();
      offDiff();
      window.removeEventListener("keydown", onKey);
    };
  }, [handleEvent]);

  return (
    <>
      <AppShell
        left={<LeftPane />}
        center={
          <>
            <MessageList />
            <Composer />
            <ApprovalCards />
          </>
        }
        right={<RightPane diffs={diffs} />}
        statusbar={
          <>
            {versions
              ? `IPC ok · electron ${versions.electron} · node ${versions.node}`
              : "IPC 检测中…"}
            {modelName && <span className="model-badge">{modelName}</span>}
            <button
              className="ghost-btn"
              style={{ marginLeft: "auto" }}
              onClick={() => setSettingsOpen(true)}
            >
              设置
            </button>
          </>
        }
      />
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {paletteOpen && (
        <CommandPalette onClose={() => setPaletteOpen(false)} onOpenSettings={() => setSettingsOpen(true)} />
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>
    </>
  );
}
