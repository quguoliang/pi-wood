import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "./components/layout/AppShell";
import { MessageList } from "./components/center/MessageList";
import { Composer } from "./components/center/Composer";
import { ApprovalCards } from "./components/center/ApprovalCards";
import { SettingsModal } from "./components/center/SettingsModal";
import { PackageMarket } from "./components/center/PackageMarket";
import { CommandPalette } from "./components/center/CommandPalette";
import { UiRequestDialogs } from "./components/center/UiRequestDialogs";
import { LeftPane } from "./components/left/LeftPane";
import { EnvironmentPanel } from "./components/center/EnvironmentPanel";
import { ConversationHeader } from "./components/center/ConversationHeader";
import { ConversationAssist } from "./components/center/ConversationAssist";
import { Toaster } from "./components/ui/sonner";
import { useSessionStore } from "./stores/session-store";
import { useRuntimeStore } from "./stores/runtime-store";
import { useBtwStore } from "./stores/btw-store";
import { useAssistStore } from "./stores/assist-store";
import { openWorkbench, openWorkbenchFile, useWorkbenchStore } from "./stores/workbench-store";
import { cycleColumnFocus, focusColumn } from "./hooks/use-column-focus";

const RightPane = lazy(() => import("./components/right/RightPane").then((module) => ({ default: module.RightPane })));

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const handleEvent = useSessionStore((s) => s.handleEvent);
  const trackRuntimeEvent = useRuntimeStore((s) => s.trackEvent);
  const addDiff = useWorkbenchStore((s) => s.addDiff);

  useEffect(() => {
    // 主题（T3.3）：settings.theme.fallback → <html data-theme>
    void window.pi.settingsGet().then((s) => {
      const t = (s as { theme?: { fallback?: string } }).theme?.fallback;
      if (t) document.documentElement.dataset.theme = t;
    });

    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && e.shiftKey && key === "p") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (mod && e.shiftKey && key === "b") {
        e.preventDefault();
        openWorkbench("btw");
      } else if (mod && !e.shiftKey && key === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (mod && !e.shiftKey && key === "n") {
        e.preventDefault();
        window.dispatchEvent(new Event("piwood:new-session"));
      } else if (mod && e.shiftKey && key === "g") {
        e.preventDefault();
        openWorkbench("diff");
      } else if (mod && !e.shiftKey && e.key === "`") {
        e.preventDefault();
        openWorkbench("term");
      } else if (mod && !e.shiftKey && key === "t") {
        e.preventDefault();
        openWorkbench("browser");
      } else if (mod && !e.shiftKey && key === "p") {
        e.preventDefault();
        openWorkbench("files");
      } else if (mod && !e.shiftKey && (key === "1" || key === "2" || key === "3")) {
        // T5.1 直达三栏焦点（Ctrl+1/2/3；Ctrl+Tab·Alt 组合在 Win/Electron 被系统吞，故用 Ctrl 组合）
        e.preventDefault();
        focusColumn(key === "1" ? "left" : key === "2" ? "center" : "right");
      } else if (mod && key === ".") {
        // T5.1 三栏焦点循环（Ctrl+. 前进 / Ctrl+Shift+. 后退；不劫持裸 Tab）
        e.preventDefault();
        cycleColumnFocus(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    const openPalette = (): void => setPaletteOpen(true);
    const openSettings = (): void => setSettingsOpen(true);
    const openMarket = (): void => setMarketOpen(true);
    window.addEventListener("piwood:open-command-palette", openPalette);
    window.addEventListener("piwood:open-settings", openSettings);
    window.addEventListener("piwood:open-marketplace", openMarket);

    const pushToast = (message: string, type: string): void => {
      if (type === "error") toast.error(message);
      else if (type === "warning") toast.warning(message);
      else toast(message);
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
    const offBtwEvt = window.pi.onBtwEvent((event) => useBtwStore.getState().handleEvent(event));
    const offAssist = window.pi.onAssistResult((data) => {
      const s = useSessionStore.getState();
      useAssistStore.getState().set({ recap: data.recap, suggestions: data.suggestions, session: s.currentSessionId ?? "", forItemsLen: s.items.length });
    });
    const offDiff = window.pi.onDiff((data) => {
      addDiff(data);
      openWorkbench("diff");
    });
    return () => {
      offNotify();
      offEvt();
      offBtwEvt();
      offAssist();
      offDiff();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("piwood:open-command-palette", openPalette);
      window.removeEventListener("piwood:open-settings", openSettings);
      window.removeEventListener("piwood:open-marketplace", openMarket);
    };
  }, [addDiff, handleEvent, trackRuntimeEvent]);

  return (
    <>
      <AppShell
        left={
          <div data-col-region="left" tabIndex={-1} className="h-full min-h-0 outline-none transition-shadow focus:ring-2 focus:ring-inset focus:ring-ring/60">
            <LeftPane onOpenSettings={() => setSettingsOpen(true)} />
          </div>
        }
        center={
          <div
            data-col-region="center"
            tabIndex={-1}
            className="relative flex h-full min-h-0 flex-col bg-surface-app outline-none transition-shadow focus:ring-2 focus:ring-inset focus:ring-ring/60"
            style={{ ["--pk-chat-width" as string]: "48rem" }}
          >
            <ConversationHeader environmentOpen={environmentOpen} onEnvironmentToggle={() => setEnvironmentOpen((open) => !open)} />
            <MessageList />
            <ConversationAssist className="pt-1" />
            <Composer />
            <ApprovalCards />
            <EnvironmentPanel open={environmentOpen} onOpenChange={setEnvironmentOpen} />
          </div>
        }
        right={
          <div data-col-region="right" tabIndex={-1} className="h-full min-h-0 outline-none transition-shadow focus:ring-2 focus:ring-inset focus:ring-ring/60">
            <Suspense fallback={<div className="grid h-full place-items-center text-muted-foreground text-sm">正在载入工作台…</div>}>
              <RightPane />
            </Suspense>
          </div>
        }
      />
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {marketOpen && <PackageMarket onClose={() => setMarketOpen(false)} />}
      {paletteOpen && (
        <CommandPalette onClose={() => setPaletteOpen(false)} onOpenSettings={() => setSettingsOpen(true)} />
      )}
      <UiRequestDialogs />
      <Toaster />
    </>
  );
}
