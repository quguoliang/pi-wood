import { useEffect, useState } from "react";
import { useSessionStore } from "../../stores/session-store";
import type { TreeEntry } from "@pi-wood/engine";

/**
 * T1.4 左栏：ProjectPane + SessionPane（会话列表 + 会话树）。
 * 数据全部来自 data.ipc（project:* / sessions:*），树渲染用 @pi-wood/engine flattenTree。
 */
interface ProjectRec {
  id: string;
  path: string;
  name: string;
}

interface SessionItem {
  file: string;
  id: string;
  name?: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
}

interface TreeRow {
  id: string;
  type: string;
  depth: number;
  activeBranch: boolean;
}

export function LeftPane(): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectRec[]>([]);
  const [activeProject, setActiveProject] = useState<string | undefined>();
  const [trust, setTrust] = useState<string>("not-required");
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [activeSession, setActiveSession] = useState<SessionItem | undefined>();
  const [treeRows, setTreeRows] = useState<TreeRow[]>([]);
  const setActiveProjectStore = useSessionStore((s) => s.setActiveProject);
  const setEngineReady = useSessionStore((s) => s.setEngineReady);
  const reset = useSessionStore((s) => s.reset);
  const loadMessages = useSessionStore((s) => s.loadMessages);

  const refreshProjects = (): void => {
    void window.pi.projectList().then((list) => setProjects(list as ProjectRec[]));
  };

  useEffect(() => {
    refreshProjects();
    // 命令面板的项目切换事件（完整切换流程复用 selectProject）
    const onSelect = (e: Event): void => {
      const path = (e as CustomEvent<string>).detail;
      const rec = projects.find((p) => p.path === path);
      if (rec) selectProject(rec);
    };
    window.addEventListener('pidesk:select-project', onSelect);
    return () => window.removeEventListener('pidesk:select-project', onSelect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  const selectProject = (p: ProjectRec): void => {
    setActiveProject(p.path);
    setActiveProjectStore(p.path);
    reset();
    void window.pi.projectTrust(p.path).then(setTrust);
    void window.pi.sessionsList(p.path).then((list) => setSessions(list as SessionItem[]));
    void window.pi.engineStart(p.path).then(() => setEngineReady(true));
  };

  const addProject = (): void => {
    void window.pi.projectPick().then((path) => {
      if (!path) return;
      void window.pi.projectAdd(path).then(() => {
        refreshProjects();
        const rec = { id: "", path, name: path.split(/[\\/]/).pop() ?? path };
        selectProject(rec);
      });
    });
  };

  const selectSession = (s: SessionItem): void => {
    setActiveSession(s);
    // 点击会话 = 切换引擎到该会话 + 装载历史（续写）
    void window.pi.sessionsTree(s.file).then((result) => {
      const rows = (result as { rows: Array<TreeEntry & { depth: number; activeBranch: boolean }> }).rows;
      setTreeRows(rows.map((r) => ({ id: r.id, type: r.type, depth: r.depth, activeBranch: r.activeBranch })));
    });
    void window.pi
      .sessionsMessages(s.file)
      .then((items) => loadMessages(items as Array<{ role: string; text: string }>))
      .then(() => window.pi.engineSwitchSession(s.file))
      .catch(() => undefined);
  };

  return (
    <div className="left-pane">
      <div className="pane-section">
        <div className="pane-header">
          <b>项目</b>
          <button className="ghost-btn" onClick={addProject}>＋添加</button>
        </div>
        {projects.length === 0 && <p className="muted">还没有项目，点击"＋添加"</p>}
        {projects.map((p) => (
          <div
            key={p.id}
            className={`project-item ${activeProject === p.path ? "active" : ""}`}
            onClick={() => selectProject(p)}
            title={p.path}
          >
            {p.name}
            {trust !== "not-required" && activeProject === p.path && (
              <span className={`trust trust-${trust}`}>{trust === "trusted" ? "已信任" : "未信任"}</span>
            )}
          </div>
        ))}
      </div>

      <div className="pane-section">
        <div className="pane-header">
          <b>会话</b>
          <button
            className="ghost-btn"
            disabled={!activeProject}
            onClick={() => {
              void window.pi.engineNewSession().then(() => {
                reset();
                if (activeProject) {
                  void window.pi.sessionsList(activeProject).then((list) => setSessions(list as SessionItem[]));
                }
              });
            }}
          >
            ＋新会话
          </button>
        </div>
        {activeProject && sessions.length === 0 && <p className="muted">该项目还没有会话</p>}
        {sessions.slice(0, 20).map((s) => (
          <div
            key={s.id}
            className={`session-item ${activeSession?.id === s.id ? "active" : ""}`}
            onClick={() => selectSession(s)}
            title={s.file}
          >
            <div className="session-first">{s.firstMessage || "(空会话)"}</div>
            <div className="muted session-meta">{new Date(s.modified).toLocaleString()} · {s.messageCount} 条</div>
          </div>
        ))}
      </div>

      {activeSession && treeRows.length > 0 && (
        <div className="pane-section">
          <div className="pane-header"><b>会话树</b></div>
          <div className="session-tree">
            {treeRows.map((row) => (
              <div
                key={row.id}
                className={`tree-row ${row.activeBranch ? "active-branch" : ""}`}
                style={{ paddingLeft: row.depth * 14 }}
                title={row.id}
              >
                {row.type}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

