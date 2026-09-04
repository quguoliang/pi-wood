import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useSessionStore } from "../../stores/session-store";
import { useThemeStore } from "../../stores/theme-store";

/**
 * T2.3 终端面板：xterm + 主进程 pty（@lydell/node-pty）。
 * T8.7 步骤 5：终端改 **per-对话**（此前每项目 1 个、换项目 kill）——每条对话一个实例，
 * 切对话保留各自 shell 与滚动缓冲；全局上限 8 个，超出按最久未使用回收（close 即 kill）。
 * 主进程按 conversationId 解析 cwd（= 该对话的 worktree，降级主项目目录）。
 */
const MAX_TERMINALS = 8;

interface TermInstance {
  term: Terminal;
  fit: FitAddon;
  termId?: string;
  /** 非活跃对话的输出缓冲（xterm 实例常驻即自带缓冲，这里只记创建参数避免重复 create） */
  createdAt: number;
  lastUsedAt: number;
  wired: boolean;
}

export function TerminalPanel(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const activeConversationId = useSessionStore((s) => s.activeConversationId);
  const activeProject = useSessionStore((s) => s.activeProject);
  const instancesRef = useRef<Map<string, TermInstance>>(new Map());
  const offRefsRef = useRef<Array<() => void> | undefined>(undefined);

  // 全局 pty 输出订阅只挂一次，按 id 路由到对应 xterm 实例
  useEffect(() => {
    const offData = window.pi.onTermData(({ id: tid, data }) => {
      for (const inst of instancesRef.current.values()) {
        if (inst.termId === tid) void inst.term.write(data);
      }
    });
    const offExit = window.pi.onTermExit(({ id: tid }) => {
      for (const inst of instancesRef.current.values()) {
        if (inst.termId === tid) inst.term.writeln(`\r\n[进程退出]`);
      }
    });
    offRefsRef.current = [offData, offExit];
    return () => {
      for (const off of offRefsRef.current ?? []) off();
      for (const [, inst] of instancesRef.current) {
        if (inst.termId) void window.pi.termKill(inst.termId);
        inst.term.dispose();
      }
      instancesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const key = activeConversationId ?? activeProject ?? "";
    if (!key) return;

    let inst = instancesRef.current.get(key);
    if (!inst) {
      // LRU 上限：满员时回收最久未使用（kill pty，终端即销毁）
      if (instancesRef.current.size >= MAX_TERMINALS) {
        let oldestKey: string | undefined;
        let oldestAt = Number.POSITIVE_INFINITY;
        for (const [k, v] of instancesRef.current) {
          if (v.lastUsedAt < oldestAt) {
            oldestAt = v.lastUsedAt;
            oldestKey = k;
          }
        }
        if (oldestKey) {
          const victim = instancesRef.current.get(oldestKey);
          if (victim?.termId) void window.pi.termKill(victim.termId);
          victim?.term.dispose();
          instancesRef.current.delete(oldestKey);
        }
      }
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
      inst = { term, fit, createdAt: Date.now(), lastUsedAt: Date.now(), wired: false };
      instancesRef.current.set(key, inst);

      // cwd 由主进程按对话解析（worktree）；未指明对话时主进程回落 active workspace
      void window.pi
        .termCreate({ cwd: activeProject ?? ".", conversationId: activeConversationId ?? undefined, cols: term.cols, rows: term.rows })
        .then((created) => {
          inst!.termId = created;
          term.writeln(`pi-wood 终端（对话 ${activeConversationId ? activeConversationId.slice(-6) : "全局"}）\r\n`);
        })
        .catch((err) => term.writeln(`终端创建失败: ${String(err)}`));
    }
    inst.lastUsedAt = Date.now();

    // 挂载当前实例的 DOM（切对话时旧实例的 DOM 被移除但 xterm 实例与缓冲保留在内存）
    host.innerHTML = "";
    const el = document.createElement("div");
    el.className = "h-full w-full";
    host.appendChild(el);
    if (!inst.term.element) inst.term.open(el);
    else el.appendChild(inst.term.element);
    inst.fit.fit();
    if (inst.termId) void window.pi.termResize(inst.termId, inst.term.cols, inst.term.rows);

    if (!inst.wired) {
      inst.wired = true;
      inst.term.onData((data) => {
        const cur = instancesRef.current.get(key);
        if (cur?.termId) void window.pi.termWrite(cur.termId, data);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, activeProject]);

  return <div ref={hostRef} className="terminal-host h-full min-h-[220px] w-full" />;
}
