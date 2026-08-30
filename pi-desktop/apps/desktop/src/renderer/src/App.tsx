import { useEffect, useRef, useState } from "react";
import { AppShell } from "./components/layout/AppShell";
import { MessageList } from "./components/center/MessageList";
import { Composer } from "./components/center/Composer";
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
  const [diffs, setDiffs] = useState<Array<{ file: string; patch: string }>>([]);
  const idSeq = useRef(0);
  const handleEvent = useSessionStore((s) => s.handleEvent);

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
    const offEvt = window.pi.onEngineEvent((event) => handleEvent(event));
    const offDiff = window.pi.onDiff((data) => setDiffs((d) => [...d, data]));
    return () => {
      offNotify();
      offEvt();
      offDiff();
    };
  }, [handleEvent]);

  return (
    <AppShell
      left={<LeftPane />}
      center={
        <>
          <MessageList />
          <Composer />
        </>
      }
      right={<RightPane diffs={diffs} />}
      statusbar={
        <>
          {versions
            ? `IPC ✅ · electron ${versions.electron} · node ${versions.node}`
            : "IPC 检测中…"}
          <button
            className="ghost-btn"
            style={{ marginLeft: "auto" }}
            onClick={() => void window.pi.debugStress(10000)}
            title="开发工具：注入 1 万条消息验证虚拟列表"
          >
            压测1万
          </button>
        </>
      }
    />
  );
}
