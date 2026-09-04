import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSessionStore } from "../../stores/session-store";
import { useRuntimeStore } from "../../stores/runtime-store";

export interface ProjectRecord {
  id: string;
  path: string;
  name: string;
}

export interface SessionItem {
  file: string;
  id: string;
  name?: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
}

/**
 * 左栏数据与交互逻辑（从 LeftPane 抽出，组件层只负责呈现）：
 * 项目列表 + 每项目会话、激活（启动引擎）、展开、新建、选中、添加。
 * 副作用边界：监听 piwood:select-project / piwood:new-session 两个全局事件；
 * activateProject 用 activationSeq 防竞态（后发覆盖先发）。
 */
export function useSidebarProjects() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, SessionItem[]>>({});
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [activeProject, setActiveProject] = useState<string | undefined>();
  const [activeSessionFile, setActiveSessionFile] = useState<string | undefined>();
  const projectsRef = useRef<ProjectRecord[]>([]);
  const activationSeq = useRef(0);
  // 只取动作引用（稳定不变）：整体 useSessionStore() 会在任一后台对话切片写入时重渲染左栏
  const setStoreProject = useSessionStore((s) => s.setActiveProject);
  const setEngineReady = useSessionStore((s) => s.setEngineReady);
  const reset = useSessionStore((s) => s.reset);
  const loadHistory = useSessionStore((s) => s.loadHistory);
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
    setActiveSessionFile(undefined);
    setStoreProject(project.path);
    setEngineReady(false);
    reset();
    resetRuntime();
    try {
      await window.pi.engineStart(project.path);
      if (activation === activationSeq.current) {
        setEngineReady(true);
        void refreshRuntime();
        void useSessionStore.getState().refreshSessionId();
      }
    } catch (error) {
      if (activation === activationSeq.current) {
        setEngineReady(false);
        // 不吞错：失败原因（常见为模型凭据缺失）直接告知用户
        toast.error(`引擎启动失败：${String((error as Error)?.message ?? error)}`, { duration: 8000 });
      }
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

  const selectSession = useCallback(async (project: ProjectRecord, session: SessionItem) => {
    if (activeProject !== project.path) await activateProject(project);
    setActiveSessionFile(session.file);
    const messages = (await window.pi.sessionsMessages(session.file)) as { role: string; text: string }[];
    loadHistory(messages);
    await window.pi.engineSwitchSession(session.file);
    void refreshRuntime();
    void useSessionStore.getState().refreshSessionId();
  }, [activeProject, activateProject, loadHistory, refreshRuntime]);

  const createSession = useCallback(async (project: ProjectRecord) => {
    setExpandedProjects((current) => new Set(current).add(project.path));
    await activateProject(project);
    await window.pi.engineNewSession();
    void useSessionStore.getState().refreshSessionId();
    await refreshProjectSessions(project);
  }, [activateProject, refreshProjectSessions]);

  // 全局"新建会话"（TitleBar / Ctrl+N）落到当前激活项目
  useEffect(() => {
    const createProjectSession = () => {
      const project = projectsRef.current.find((item) => item.path === activeProject);
      if (project) void createSession(project);
    };
    window.addEventListener("piwood:new-session", createProjectSession);
    return () => window.removeEventListener("piwood:new-session", createProjectSession);
  }, [activeProject, createSession]);

  const toggleProject = useCallback((project: ProjectRecord) => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(project.path)) next.delete(project.path);
      else next.add(project.path);
      return next;
    });
    if (activeProject !== project.path) void activateProject(project);
  }, [activeProject, activateProject]);

  const addProject = useCallback(async () => {
    const path = await window.pi.projectPick();
    if (!path) return;
    const project = (await window.pi.projectAdd(path)) as ProjectRecord;
    await refreshProjects();
    await activateProject(project);
  }, [activateProject, refreshProjects]);

  // Composer 头部「打开文件夹」经全局事件复用同一激活逻辑（左栏仍是单一持有者）
  useEffect(() => {
    const onAddProject = (): void => {
      void addProject();
    };
    window.addEventListener("piwood:add-project", onAddProject);
    return () => window.removeEventListener("piwood:add-project", onAddProject);
  }, [addProject]);

  return {
    projects,
    sessionsByProject,
    expandedProjects,
    activeProject,
    activeSessionFile,
    toggleProject,
    createSession,
    selectSession,
    addProject,
  };
}
