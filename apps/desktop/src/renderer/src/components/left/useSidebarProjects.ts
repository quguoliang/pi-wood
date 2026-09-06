import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSessionStore } from "../../stores/session-store";
import { useRuntimeStore } from "../../stores/runtime-store";
import { useConversationsStore, type ConversationRow } from "../../stores/conversations-store";
import { useSessionMetaStore } from "../../stores/session-meta-store";
import { conversationTreeTitle, type ConversationTreeItem } from "./ProjectGroup";

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
 *
 * ①③④：对话注册表（conversations-store，单一轮询源）按 projectDir 归组并入树——
 * 新建对话 1.5s 内即出现在项目下（不再依赖 Pi 会话文件落盘），且带状态圆点。
 * 已被活跃对话认领的磁盘会话文件不重复展示（同一份上下文只出现一行）。
 *
 * T8.11 归档优先模型：会话元数据（归档/置顶/别名，键=会话文件路径）把列表拆成
 * 「活跃会话（置顶恒最前）」与「已归档」两组；归档的对话行同步移出活跃树。
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

  // 对话注册表（轮询在 startConversationsPolling 里，App 启动时开启）
  const convRows = useConversationsStore((s) => s.rows);
  const unreadIds = useConversationsStore((s) => s.unreadIds);
  const firstUserById = useConversationsStore((s) => s.firstUserById);
  const pendingClose = useConversationsStore((s) => s.pendingClose);
  const activeConversationId = useSessionStore((s) => s.activeConversationId);
  // T8.11：会话元数据（归档/置顶/别名）
  const metaMap = useSessionMetaStore((s) => s.meta);
  const setSessionMeta = useSessionMetaStore((s) => s.set);

  const refreshProjectSessions = useCallback(async (project: ProjectRecord) => {
    const sessions = (await window.pi.sessionsList(project.path).catch(() => [])) as SessionItem[];
    setSessionsByProject((current) => ({ ...current, [project.path]: sessions }));
  }, []);

  const refreshProjects = useCallback(async () => {
    void useSessionMetaStore.getState().load();
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
    // 换项目先清空视图归属，engineStart 回来后立刻用主进程返回的 conversationId 精确落位（见下）。
    useSessionStore.setState({ activeConversationId: null, draftProject: null });
    try {
      const res = await window.pi.engineStart(project.path);
      if (activation === activationSeq.current) {
        // 立刻把视图归属到主进程新建/复用的对话（不再等 active:true 事件回采）——
        // 否则首条 addUserMessage 会误落兜底切片，真实对话切片缺首条用户消息 → 被左栏隐藏。
        if (res?.conversationId) useSessionStore.setState({ activeConversationId: res.conversationId, draftProject: null });
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

  /**
   * 项目下「新任务」统一入口（点 + / 新建任务 / Ctrl+N）：进入草稿态，**不建对话、不 fork 引擎**。
   * 未激活的项目先激活（预热其引擎），再 startDraft——若该项目已有空的当前对话则直接复用聚焦。
   * 真正落一个任务发生在草稿首次发送那一刻（见 use-composer-controller.send 的物化分支）。
   */
  const startDraftIn = useCallback(async (project: ProjectRecord) => {
    setExpandedProjects((current) => new Set(current).add(project.path));
    if (activeProject !== project.path) await activateProject(project);
    useConversationsStore.getState().startDraft(project.path);
  }, [activeProject, activateProject]);

  // 全局"新建会话"（SidebarNav 新建任务 / Ctrl+N）落到当前激活项目（草稿态，不预建）
  useEffect(() => {
    const createProjectSession = () => {
      const project = projectsRef.current.find((item) => item.path === activeProject);
      if (project) void startDraftIn(project);
    };
    window.addEventListener("piwood:new-session", createProjectSession);
    return () => window.removeEventListener("piwood:new-session", createProjectSession);
  }, [activeProject, startDraftIn]);

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

  /* ---------------- T8.11：项目/会话管理动作（归档优先模型） ---------------- */

  /** 移除项目 = 只解除注册（projects.json 摘除），磁盘代码与会话文件零触碰 */
  const removeProject = useCallback(async (project: ProjectRecord): Promise<boolean> => {
    const busy = useConversationsStore
      .getState()
      .rows.some((r) => r.projectDir === project.path && (r.status === "streaming" || r.inFlightPrompt || r.pendingApprovals > 0));
    if (busy) {
      toast.error("该项目有任务在跑，请先关闭对话再移除项目");
      return false;
    }
    try {
      await window.pi.projectRemove?.(project.id);
    } catch (err) {
      toast.error(`移除项目失败：${String((err as Error)?.message ?? err)}`);
      return false;
    }
    toast(`已移除项目「${project.name}」`, { description: "仅解除关联；磁盘代码与会话文件均未删除" });
    await refreshProjects();
    if (activeProject === project.path) {
      setActiveProject(undefined);
      setActiveSessionFile(undefined);
      setEngineReady(false);
      reset();
      resetRuntime();
      useSessionStore.setState({ activeConversationId: null, draftProject: null });
    }
    return true;
  }, [activeProject, refreshProjects, reset, resetRuntime, setEngineReady]);

  const renameProject = useCallback(async (project: ProjectRecord, name: string) => {
    try {
      await window.pi.projectRename?.(project.id, name);
    } catch (err) {
      toast.error(`重命名失败：${String((err as Error)?.message ?? err)}`);
    }
    await refreshProjects();
  }, [refreshProjects]);

  const rowBusy = (row: ConversationRow): boolean =>
    row.status === "streaming" || row.inFlightPrompt || row.pendingApprovals > 0;

  /** 归档对话：元数据归档其会话文件 + 关闭引擎进程（关闭语义不变，归档负责「从列表消失」） */
  const archiveConversation = useCallback(async (row: ConversationRow) => {
    if (rowBusy(row)) {
      toast.error("该对话有任务在跑，先停止任务再归档");
      return;
    }
    if (row.sessionFile) await setSessionMeta(row.sessionFile, { archived: true });
    await window.pi.closeConversation?.(row.id);
    toast("对话已归档", { description: "可在项目「已归档」分组中恢复" });
    void useConversationsStore.getState().refresh();
  }, [setSessionMeta]);

  const renameConversation = useCallback((row: ConversationRow, alias: string) => {
    if (!row.sessionFile) {
      toast.error("首轮消息落盘前无法重命名，先发送一条消息");
      return;
    }
    void setSessionMeta(row.sessionFile, { alias });
  }, [setSessionMeta]);

  const renameSession = useCallback((file: string, alias: string) => {
    void setSessionMeta(file, { alias });
  }, [setSessionMeta]);

  const setSessionPinned = useCallback((file: string, pinned: boolean) => {
    void setSessionMeta(file, { pinned });
  }, [setSessionMeta]);

  const setSessionArchived = useCallback((file: string, archived: boolean) => {
    void setSessionMeta(file, { archived });
  }, [setSessionMeta]);

  /** 删除会话文件（不可逆，CLI 亦不可恢复）；主进程守卫「被活跃对话认领即拒」 */
  const deleteSession = useCallback(async (file: string): Promise<boolean> => {
    try {
      await window.pi.sessionsDelete?.(file);
    } catch (err) {
      toast.error(String((err as Error)?.message ?? err));
      return false;
    }
    toast("会话已删除", { description: "会话文件已永久删除" });
    await refreshProjects();
    if (activeSessionFile === file) setActiveSessionFile(undefined);
    return true;
  }, [activeSessionFile, refreshProjects]);

  /** 恢复归档会话：清归档标记 + 直接打开（回到活跃列表并续写） */
  const restoreSession = useCallback(async (project: ProjectRecord, session: SessionItem) => {
    await setSessionMeta(session.file, { archived: false });
    await selectSession(project, session);
  }, [selectSession, setSessionMeta]);

  /**
   * 注册表对话按项目归组 → ConversationTreeItem（标题/未读/树标）。
   * 隐藏「空草稿」对话：还没发过任何用户消息的对话不算一个任务（配合「+」不预建，避免凭空多行）。
   * 判据用 firstUserById（有首条用户消息才有条目）；正在跑/等审批的对话必然已有消息，不会误隐藏。
   * T8.11：会话文件已归档的对话行同样移出活跃树（对话归档 = 元数据归档 + 关闭进程，双保险）。
   */
  const conversationsByProject = useMemo(() => {
    const map: Record<string, ConversationTreeItem[]> = {};
    for (const row of convRows) {
      const first = firstUserById[row.id];
      if (!first) continue; // 空草稿：不展示
      const meta = row.sessionFile ? metaMap[row.sessionFile] : undefined;
      if (meta?.archived) continue;
      (map[row.projectDir] ??= []).push({
        row,
        title: meta?.alias ?? conversationTreeTitle(first, row),
        unread: unreadIds.has(row.id),
        isTree: Boolean(row.worktreePath) && row.worktreePath !== row.projectDir,
      });
    }
    return map;
  }, [convRows, firstUserById, unreadIds, metaMap]);

  /** 磁盘会话列表：被活跃对话认领的不重复展示；归档的移入 archivedSessionsByProject */
  const activeSessionsByProject = useMemo(() => {
    const claimed = new Set(convRows.map((r) => r.sessionFile).filter(Boolean) as string[]);
    const next: Record<string, SessionItem[]> = {};
    for (const [path, sessions] of Object.entries(sessionsByProject)) {
      next[path] = sessions
        .filter((s) => !claimed.has(s.file) && !metaMap[s.file]?.archived)
        // 置顶恒最前（T8.11），其余按最近修改
        .sort((a, b) => {
          const pa = metaMap[a.file]?.pinned ? 1 : 0;
          const pb = metaMap[b.file]?.pinned ? 1 : 0;
          if (pa !== pb) return pb - pa;
          return b.modified.localeCompare(a.modified);
        });
    }
    return next;
  }, [convRows, sessionsByProject, metaMap]);

  const archivedSessionsByProject = useMemo(() => {
    const claimed = new Set(convRows.map((r) => r.sessionFile).filter(Boolean) as string[]);
    const next: Record<string, SessionItem[]> = {};
    for (const [path, sessions] of Object.entries(sessionsByProject)) {
      next[path] = sessions
        .filter((s) => !claimed.has(s.file) && metaMap[s.file]?.archived)
        .sort((a, b) => b.modified.localeCompare(a.modified));
    }
    return next;
  }, [convRows, sessionsByProject, metaMap]);

  const selectConversation = useCallback((row: ConversationRow) => {
    useConversationsStore.getState().switchTo(row.id, row.projectDir);
  }, []);

  return {
    projects,
    conversationsByProject,
    sessionsByProject: activeSessionsByProject,
    archivedSessionsByProject,
    metaMap,
    expandedProjects,
    activeProject,
    activeSessionFile,
    activeConversationId,
    pendingCloseConversationId: pendingClose?.conversationId ?? null,
    toggleProject,
    startDraftIn,
    selectConversation,
    requestCloseConversation: (row: ConversationRow) => useConversationsStore.getState().requestClose(row),
    resolvePendingClose: (mode: "suspend" | "abort") => useConversationsStore.getState().resolvePendingClose(mode),
    dismissPendingClose: () => useConversationsStore.getState().dismissClose(),
    selectSession,
    addProject,
    removeProject,
    renameProject,
    archiveConversation,
    renameConversation,
    renameSession,
    setSessionPinned,
    setSessionArchived,
    deleteSession,
    restoreSession,
  };
}
