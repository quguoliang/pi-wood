import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AppShell } from "./components/layout/AppShell";
import { MessageList } from "./components/center/MessageList";
import { Composer } from "./components/center/Composer";
import { ApprovalCards } from "./components/center/ApprovalCards";
import { SettingsModal } from "./components/center/SettingsModal";
import { CommandPalette } from "./components/center/CommandPalette";
import { UiRequestDialogs } from "./components/center/UiRequestDialogs";
import { LeftPane } from "./components/left/LeftPane";
import { EnvironmentPanel } from "./components/center/EnvironmentPanel";
import { ConversationToolbar } from "./components/center/ConversationToolbar";
import { useSessionStore } from "./stores/session-store";
import { useRuntimeStore } from "./stores/runtime-store";
import { openWorkbench, openWorkbenchFile, useWorkbenchStore } from "./stores/workbench-store";

const RightPane = lazy(() => import("./components/right/RightPane").then((module) => ({ default: module.RightPane })));

interface Toast {
  id: number;
  message: string;
  type: string;
}

export default function App() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const idSeq = useRef(0);
  const handleEvent = useSessionStore((s) => s.handleEvent);
  const trackRuntimeEvent = useRuntimeStore((s) => s.trackEvent);
  const addDiff = useWorkbenchStore((s) => s.addDiff);
  const messages = useSessionStore((s) => s.messages);
  const streamBuffer = useSessionStore((s) => s.streamBuffer);
  const streaming = useSessionStore((s) => s.streaming);
  const hasConversation = messages.length > 0 || Boolean(streamBuffer) || streaming;

  useEffect(() => {
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
    const openPalette = (): void => setPaletteOpen(true);
    const openSettings = (): void => setSettingsOpen(true);
    window.addEventListener("piwood:open-command-palette", openPalette);
    window.addEventListener("piwood:open-settings", openSettings);
    const pushToast = (message: string, type: string): void => {
      const id = ++idSeq.current;
      setToasts((t) => [...t, { id, message, type }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
    };

    const offNotify = window.pi.onUiNotify((d) => pushToast(d.message, d.type));
    const offEvt = window.pi.onEngineEvent((event) => {
      handleEvent(event);
      trackRuntimeEvent(event);
      if (event.type === "tool_execution_start") {
        const tool = String(event.toolName ?? "");
        const path = (event.input as { path?: unknown } | undefined)?.path;
        if (tool === "read" && typeof path === "string") openWorkbenchFile(path);
        else if (tool === "bash") openWorkbench("term");
        else if (tool.startsWith("browser_")) openWorkbench("browser");
      }
    });
    const offDiff = window.pi.onDiff((data) => {
      addDiff(data);
      openWorkbench("diff");
    });
    return () => {
      offNotify();
      offEvt();
      offDiff();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("piwood:open-command-palette", openPalette);
      window.removeEventListener("piwood:open-settings", openSettings);
    };
  }, [addDiff, handleEvent, trackRuntimeEvent]);

  return (
    <>
      <AppShell
        left={<LeftPane onOpenSettings={() => setSettingsOpen(true)} />}
        center={
          <section className={`conversation-workspace${hasConversation ? " has-conversation" : " is-empty"}`}>
            <ConversationToolbar environmentOpen={environmentOpen} onEnvironmentToggle={() => setEnvironmentOpen((open) => !open)} />
            <div className="conversation-main">
              <MessageList />
              <Composer />
            </div>
            <ApprovalCards />
            <EnvironmentPanel open={environmentOpen} onOpenChange={setEnvironmentOpen} />
          </section>
        }
        right={<Suspense fallback={<div className="workbench-empty"><p>正在载入工作台…</p></div>}><RightPane /></Suspense>}
      />
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {paletteOpen && (
        <CommandPalette onClose={() => setPaletteOpen(false)} onOpenSettings={() => setSettingsOpen(true)} />
      )}
      <UiRequestDialogs />
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
