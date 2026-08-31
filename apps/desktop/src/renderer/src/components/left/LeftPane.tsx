import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionStore } from "../../stores/session-store";
import { useRuntimeStore } from "../../stores/runtime-store";
import { Icon } from "../ui/Icon";

interface ProjectRecord {
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

export function LeftPane({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, SessionItem[]>>({});
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [activeProject, setActiveProject] = useState<string>();
  const [activeSession, setActiveSession] = useState<SessionItem>();
  const projectsRef = useRef<ProjectRecord[]>([]);
  const activationSeq = useRef(0);
  const { setActiveProject: setStoreProject, setEngineReady, reset, loadMessages } = useSessionStore();
  const refreshRuntime = useRuntimeStore((s) => s.refresh);
  const resetRuntime = useRuntimeStore((s) => s.reset);

  const refreshProjectSessions = useCallback(async (project: ProjectRecord) => {
    const sessions = (await window.pi.sessionsList(project.path).catch(() => [])) as SessionItem[];
    setSessionsByProject((current) => ({ ...current, [project.path]: sessions }));
  }, []);

  const refreshProjects = useCallback(async () => {
    const projectList = (await window.pi.projectList()) as ProjectRecord[];
    projectsRef.current = projectList;
    setProjects(projectList);

    const grouped = await Promise.all(
      projectList.map(async (project) => [
        project.path,
        (await window.pi.sessionsList(project.path).catch(() => [])) as SessionItem[],
      ] as const),
    );
    setSessionsByProject(Object.fromEntries(grouped));
  }, []);

  const activateProject = useCallback(async (project: ProjectRecord) => {
    const activation = ++activationSeq.current;
    setActiveProject(project.path);
    setActiveSession(undefined);
    setStoreProject(project.path);
    setEngineReady(false);
    reset();
    resetRuntime();
    try {
      await window.pi.engineStart(project.path);
      if (activation === activationSeq.current) {
        setEngineReady(true);
        void refreshRuntime();
      }
    } catch (error) {
      if (activation === activationSeq.current) setEngineReady(false);
      console.error("项目引擎启动失败", error);
    }
  }, [reset, resetRuntime, refreshRuntime, setEngineReady, setStoreProject]);

  useEffect(() => {
    void refreshProjects();

    const selectProject = (event: Event) => {
      const projectPath = (event as CustomEvent<string>).detail;
      const project = projectsRef.current.find((item) => item.path === projectPath);
      if (project) void activateProject(project);
    };
    window.addEventListener("piwood:select-project", selectProject);
    return () => window.removeEventListener("piwood:select-project", selectProject);
  }, [activateProject, refreshProjects]);

  const selectSession = async (project: ProjectRecord, session: SessionItem) => {
    if (activeProject !== project.path) await activateProject(project);
    setActiveSession(session);
    const messages = (await window.pi.sessionsMessages(session.file)) as { role: string; text: string }[];
    loadMessages(messages);
    await window.pi.engineSwitchSession(session.file);
    void refreshRuntime();
  };

  const createSession = useCallback(async (project: ProjectRecord) => {
    setExpandedProjects((current) => new Set(current).add(project.path));
    await activateProject(project);
    await window.pi.engineNewSession();
    await refreshProjectSessions(project);
  }, [activateProject, refreshProjectSessions]);

  useEffect(() => {
    const createProjectSession = () => {
      const project = projectsRef.current.find((item) => item.path === activeProject);
      if (project) void createSession(project);
    };
    window.addEventListener("piwood:new-session", createProjectSession);
    return () => window.removeEventListener("piwood:new-session", createProjectSession);
  }, [activeProject, createSession]);

  const toggleProject = (project: ProjectRecord) => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(project.path)) next.delete(project.path);
      else next.add(project.path);
      return next;
    });
    if (activeProject !== project.path) void activateProject(project);
  };

  const addProject = async () => {
    const path = await window.pi.projectPick();
    if (!path) return;
    const project = (await window.pi.projectAdd(path)) as ProjectRecord;
    await refreshProjects();
    await activateProject(project);
  };

  return (
    <aside className="left-pane" aria-label="项目与会话">
      <section className="project-collection">
        <header className="project-list-header">
          <span>项目</span>
          <button type="button" onClick={() => void addProject()}>
            <Icon name="add" size={14} /> 添加
          </button>
        </header>

        <div className="project-tree">
          {projects.map((project) => {
            const isActiveProject = activeProject === project.path;
            const isExpanded = expandedProjects.has(project.path);
            const sessions = sessionsByProject[project.path] ?? [];
            return (
              <section className={`project-group${isActiveProject ? " active" : ""}`} key={project.path}>
                <div className="project-row">
                  <button
                    className="project-item"
                    type="button"
                    onClick={() => toggleProject(project)}
                  >
                    <Icon name={isExpanded ? "folderOpen" : "folder"} size={16} />
                    <span>{project.name}</span>
                  </button>
                  <button
                    className="project-session-add"
                    type="button"
                    title={`在 ${project.name} 中新建会话`}
                    aria-label={`在 ${project.name} 中新建会话`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void createSession(project);
                    }}
                  >
                    <Icon name="add" size={14} />
                  </button>
                </div>

                {isExpanded && sessions.map((session) => (
                  <button
                    className={`project-session${activeSession?.file === session.file ? " active" : ""}`}
                    key={session.file}
                    type="button"
                    title={session.firstMessage || "空会话"}
                    onClick={() => void selectSession(project, session)}
                  >
                    <span>{session.firstMessage || "空会话"}</span>
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      </section>

      <footer className="sidebar-footer">
        <button type="button" onClick={onOpenSettings}>
          <Icon name="settings" size={16} /> 设置
        </button>
      </footer>
    </aside>
  );
}
