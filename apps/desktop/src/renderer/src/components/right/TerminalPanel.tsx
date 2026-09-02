import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useSessionStore } from "../../stores/session-store";
import { useThemeStore } from "../../stores/theme-store";

/** T2.3 终端面板：xterm + 主进程 pty（@lydell/node-pty） */
export function TerminalPanel(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const termIdRef = useRef<string | undefined>(undefined);
  const activeProject = useSessionStore((s) => s.activeProject);

  useEffect(() => {
    if (!activeProject || termRef.current) return;
    const term = new Terminal({
      fontSize: 12,
      fontFamily: "Consolas, monospace",
      theme: useThemeStore.getState().terminalTheme ?? {
        background: "#16171f",
        foreground: "#c0caf5",
        cursor: "#7aa2f7",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current!);
    fit.fit();

    let id: string | undefined;
    void window.pi
      .termCreate({ cwd: activeProject, cols: term.cols, rows: term.rows })
      .then((created) => {
        id = created;
        termIdRef.current = created;
        term.writeln(`pi-wood 终端（${activeProject}）\r\n`);
      })
      .catch((err) => term.writeln(`终端创建失败: ${String(err)}`));

    const offData = window.pi.onTermData(({ id: tid, data }) => {
      if (tid === id) term.write(data);
    });
    const offExit = window.pi.onTermExit(({ id: tid }) => {
      if (tid === id) term.writeln(`\r\n[进程退出]`);
    });
    term.onData((data) => {
      if (termIdRef.current) void window.pi.termWrite(termIdRef.current, data);
    });

    const refit = (): void => {
      fit.fit();
      if (termIdRef.current) void window.pi.termResize(termIdRef.current, term.cols, term.rows);
    };
    // 观察宿主尺寸：标签切走再切回（display:none→block）、面板拖宽都能触发 refit
    const ro = new ResizeObserver(refit);
    if (hostRef.current) ro.observe(hostRef.current);

    return () => {
      offData();
      offExit();
      ro.disconnect();
      if (termIdRef.current) void window.pi.termKill(termIdRef.current);
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject]);

  return <div ref={hostRef} className="terminal-host h-full min-h-[220px] w-full" />;
}
