import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSessionStore } from "../../stores/session-store";
import { useRuntimeStore } from "../../stores/runtime-store";
import { useConversationsStore, type ConversationRow } from "../../stores/conversations-store";
import { useSessionMetaStore } from "../../stores/session-meta-store";
import { useContextTreeStore } from "../../stores/context-tree-store";
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

/** 左栏单一列表的一行：活跃对话（注册表认领）或历史会话（磁盘）；key=会话文件路径（认领前后原地换形态）；time=排序与展示共用的稳定时间 */
export type SidebarRow =
  | { kind: "conv"; key: string; time: string; item: ConversationTreeItem }
  | { kind: "session"; key: string; time: string; session: SessionItem };

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
  // 「最近」虚拟项目（~/.pi-wood/chats）：普通对话的默认归属，不入 projects.json
  const [virtualProject, setVirtualProject] = useState<ProjectRecord | undefined>();
  const virtualRef = useRef<ProjectRecord | undefined>(undefined);
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

    // 「最近」虚拟项目：一并纳入查找表（piwood:select-project 也能选中它）
    try {
      const dir = (await window.pi.projectVirtualDir?.()) as string | undefined;
      if (dir) {
        const virtual = { id: "virtual", path: dir, name: "最近" };
        virtualRef.current = virtual;
        setVirtualProject(virtual);
        projectsRef.current = [...projectList, virtual];
        const vSessions = (await window.pi.sessionsList(dir).catch(() => [])) as SessionItem[];
        setSessionsByProject((current) => ({ ...current, [dir]: vSessions }));
      }
    } catch {
      /* 虚拟目录不可用（罕见）则维持纯项目模式 */
    }

    const grouped = await Promise.all(
      projectList.map(async (project) => [
        project.path,
        (await window.pi.sessionsList(project.path).catch(() => [])) as SessionItem[],
      ] as const),
    );
    // 顺序必须是「旧值打底、新值覆盖」：反写（{...fresh, ...current}）会让已有项目永远保留旧列表——
    // 删掉的会话行因此「删了还在」，直到重启重读磁盘。虚拟目录在上面单独写入，此处不在 grouped 内，不受影响。
    setSessionsByProject((current) => ({ ...current, ...Object.fromEntries(grouped) }));
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
    // 用 store 的 activeProject 判定（switchTo 只更新 store 侧，hook 本地值可能滞后）：
    // 判错会跳过激活，把「别的项目的活跃对话」切去认领这条文件 → 行跨分组乱跳
    if (useSessionStore.getState().activeProject !== project.path) await activateProject(project);
    setActiveSessionFile(session.file);

    // 先定「谁来认领」：正常就是正在看的这条对话；草稿态下主进程活跃指针可能另有其主，
    // 用 engineStart（引擎已起时毫秒返回）把活跃对话要回来。定不了人就不乐观切换。
    let convId = useSessionStore.getState().activeConversationId;
    if (!convId) {
      const started = await window.pi.engineStart(project.path).catch(() => undefined);
      convId = started?.conversationId ?? null;
      if (convId) useSessionStore.setState({ activeConversationId: convId, draftProject: null });
    }

    const switchInBackground = async (): Promise<void> => {
      // 引擎 switchSession 要在子进程里重建服务（Pi SDK/jiti 冷装配，实测 1~2s）——
      // 绝不串在点击路径上：视图先换底，这里后台完成，期间该对话禁用发送。
      const doSwitch = (): Promise<{ conversationId?: string } | undefined> =>
        window.pi.engineSwitchSession(session.file, useSessionStore.getState().activeConversationId ?? undefined);
      let res: { conversationId?: string } | undefined;
      try {
        res = await doSwitch();
      } catch {
        try {
          await activateProject(project);
          res = await doSwitch();
        } catch (err) {
          toast.error(`打开会话失败：${String((err as Error)?.message ?? err)}`, { duration: 6000 });
          useSessionStore.getState().setEngineReady(true, useSessionStore.getState().activeConversationId);
          return;
        }
      }
      const claimed = res?.conversationId ?? convId ?? useSessionStore.getState().activeConversationId;
      if (!claimed) return;
      // 认领方与乐观换底的那条对话不一致（重试激活换了人）：重新锚定视图并再换一次底
      // （activateProject 会清空切片——即便 claimed 已是当前活跃，它的切片里还没有这条会话的内容）
      if (claimed !== convId) {
        useSessionStore.getState().setActiveConversation(claimed);
        await useContextTreeStore.getState().refresh(claimed, session.file, { force: true });
        await useSessionStore.getState().rebaseToBranch(claimed);
      }
      useSessionStore.getState().setEngineReady(true, claimed);
      void refreshRuntime();
      void useSessionStore.getState().refreshSessionId(claimed);
    };

    if (!convId) {
      // 兜底：定不了认领方，退回串行（慢但语义与旧一致），失败必须 toast 不静默
      try {
        const res = await window.pi.engineSwitchSession(session.file);
        const bound = res?.conversationId ?? useSessionStore.getState().activeConversationId;
        if (bound) {
          useSessionStore.getState().setActiveConversation(bound);
          await useContextTreeStore.getState().refresh(bound, session.file, { force: true });
          await useSessionStore.getState().rebaseToBranch(bound);
          void useSessionStore.getState().refreshSessionId(bound);
        }
        void refreshRuntime();
      } catch (err) {
        toast.error(`打开会话失败：${String((err as Error)?.message ?? err)}`, { duration: 6000 });
      }
      return;
    }

    // 乐观快路径：立刻锚定对话 + 按磁盘文件换底（纯读，毫秒级），引擎切换挂后台
    useSessionStore.getState().markHistoryLoaded(convId); // 先封住 ensureHistoryLoaded 的 merge 装载：
    // 后台切换完成前注册表还指向旧文件，放任它 merge 会把旧会话内容竞态混进刚换好的底
    useSessionStore.getState().setActiveConversation(convId); // 退草稿态 + 清未读 + 告知主进程可见性
    useSessionStore.getState().setEngineReady(false, convId); // 换会话完成前禁用发送，防止 prompt 打进旧会话
    // 本地即时认领：注册表行的 sessionFile 当场改成被点文件——对话行与旧文件让出的会话行
    // 在点击同一帧各自换位（行 key=文件路径，原地换形态），不存在「旧行对话高亮 + 新行会话
    // 高亮」的双选中中间态。主进程认领前置保证下一轮轮询结果一致，无回弹；切换失败时
    // 主进程回滚认领，本行随轮询自然退回。
    useConversationsStore.setState((s) => ({
      rows: s.rows.map((r) => (r.id === convId && r.sessionFile !== session.file ? { ...r, sessionFile: session.file } : r)),
    }));
    void (async () => {
      await useContextTreeStore.getState().refresh(convId, session.file, { force: true });
      await useSessionStore.getState().rebaseToBranch(convId);
    })();
    void switchInBackground();
  }, [activateProject, refreshRuntime]);

  /**
   * 项目下「新任务」统一入口（点 + / 新建任务 / Ctrl+N）：进入草稿态，**不建对话、不 fork 引擎**。
   * 未激活的项目先激活（预热其引擎），再 startDraft——若该项目已有空的当前对话则直接复用聚焦。
   * 真正落一个任务发生在草稿首次发送那一刻（见 use-composer-controller.send 的物化分支）。
   */
  const startDraftIn = useCallback(async (project: ProjectRecord) => {
    setExpandedProjects((current) => new Set(current).add(project.path));
    setActiveSessionFile(undefined); // 草稿态没有任何选中行，清掉残留的会话选中态
    if (activeProject !== project.path) await activateProject(project);
    useConversationsStore.getState().startDraft(project.path);
  }, [activeProject, activateProject]);

  // 全局"新建会话"（SidebarNav 新建任务 / Ctrl+N）落到当前激活项目；无激活项目 → 「最近」虚拟项目
  useEffect(() => {
    const createProjectSession = () => {
      const project = projectsRef.current.find((item) => item.path === activeProject) ?? virtualRef.current;
      if (project) void startDraftIn(project);
    };
    window.addEventListener("piwood:new-session", createProjectSession);
    return () => window.removeEventListener("piwood:new-session", createProjectSession);
  }, [activeProject, startDraftIn]);

  // 「最近」虚拟项目：启动时默认进入（引擎就绪 → 不选项目也能直接对话/调模型），并默认展开
  useEffect(() => {
    if (!virtualProject) return;
    setExpandedProjects((current) => new Set(current).add(virtualProject.path));
    if (!activeProject && !useSessionStore.getState().activeConversationId) {
      void activateProject(virtualProject);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualProject]);

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

  /** IPC 报错会被包一层 "Error invoking remote method 'sessions:delete': Error: xxx"——剥壳只留人话 */
  const formatDeleteError = (err: unknown): string => {
    const raw = String((err as Error)?.message ?? err);
    const idx = raw.lastIndexOf("Error: ");
    return idx >= 0 ? raw.slice(idx + 7).trim() : raw;
  };

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

  /**
   * 删除会话文件（不可逆，CLI 亦不可恢复）；主进程守卫「被活跃对话认领即拒」。
   * ⚠️ 2026-09-11：被拒时**必须如实告知且让行留在原地**。旧实现只弹一条瞬时 toast，而随后的
   * 「该文件被对话认领 → 会话行隐去」会让用户把**渲染层的隐去**误读成删除成功——
   * 文件其实还在磁盘上，重启后照旧出现（本次用户报障即此形态）。
   */
  const deleteSession = useCallback(async (file: string): Promise<boolean> => {
    // 不能写成 `window.pi.sessionsDelete?.(file)`：可选链在 API 缺失时**静默变成空操作**，
    // 而下面照样会弹「会话已删除」——用户以为删了、文件仍在盘上。
    if (typeof window.pi.sessionsDelete !== "function") {
      toast.error("当前构建未注入会话删除能力（preload 缺 sessionsDelete），请重启应用后再试", { duration: 8000 });
      return false;
    }
    // 该文件当前挂在哪个目录：删除后要在**同一目录**复核它是否真的消失（见下）
    let ownerDir: string | undefined;
    for (const [path, list] of Object.entries(sessionsByProject)) {
      if (list.some((s) => s.file === file)) {
        ownerDir = path;
        break;
      }
    }
    try {
      await window.pi.sessionsDelete(file);
    } catch (err) {
      // 主进程拒绝（最常见＝该会话正被某条对话占用）：先把对话表刷成权威态，
      // 让认领关系显形（该行随之变回对话行、可经其「关闭」入口解开占用），并给出可执行指引
      void useConversationsStore.getState().refresh();
      toast.error(formatDeleteError(err), { duration: 8000 });
      return false;
    }
    await refreshProjects();
    // ⚠️ 复核：IPC 不抛错 ≠ 文件真的没了。只要它在磁盘列表里还在，就**绝不**提示「已删除」——
    // 这正是用户报障的形态（以为删掉了，其实文件仍在，重启后又出现）。宁可报「未生效」也不假成功。
    if (ownerDir) {
      const after = (await window.pi.sessionsList(ownerDir).catch(() => [])) as SessionItem[];
      if (after.some((s) => s.file === file)) {
        toast.error("删除未生效：会话文件仍在磁盘上。请先关闭占用它的对话，再删除该会话。", { duration: 10000 });
        return false;
      }
    }
    // 乐观摘除：不等下一轮刷新，避免任何窗口期里被删的行仍挂在树上（「删了还在」）
    setSessionsByProject((current) => {
      const next: Record<string, SessionItem[]> = {};
      for (const [path, list] of Object.entries(current)) next[path] = list.filter((s) => s.file !== file);
      return next;
    });
    toast("会话已删除", { description: "会话文件已永久删除" });
    if (activeSessionFile === file) setActiveSessionFile(undefined);
    return true;
  }, [activeSessionFile, refreshProjects, sessionsByProject]);

  /**
   * 注册表对话按项目归组 → ConversationTreeItem（标题/未读/树标）。
   * 隐藏「空草稿」对话：还没发过任何用户消息的对话不算一个任务（配合「+」不预建，避免凭空多行）。
   * 判据用 firstUserById（有首条用户消息才有条目）；正在跑/等审批的对话必然已有消息，不会误隐藏。
   * T8.11：会话文件已归档的对话行同样移出活跃树（对话归档 = 元数据归档 + 关闭进程，双保险）。
   * 标题优先取磁盘会话行同源（name/firstMessage）：同一文件被对话认领前后标题一字不差，
   * 否则「点击后行标题变化」会以另一种形式回来（tabTitle 24 字截断 ≠ firstMessage 120 字）。
   */
  const conversationsByProject = useMemo(() => {
    const sessionByFile = new Map<string, SessionItem>();
    for (const list of Object.values(sessionsByProject)) for (const s of list) sessionByFile.set(s.file, s);
    const map: Record<string, ConversationTreeItem[]> = {};
    for (const row of convRows) {
      const first = firstUserById[row.id];
      if (!first) continue; // 空草稿：不展示
      const meta = row.sessionFile ? metaMap[row.sessionFile] : undefined;
      if (meta?.archived) continue;
      const disk = row.sessionFile ? sessionByFile.get(row.sessionFile) : undefined;
      (map[row.projectDir] ??= []).push({
        row,
        title: meta?.alias ?? disk?.name ?? disk?.firstMessage ?? conversationTreeTitle(first, row),
        unread: unreadIds.has(row.id),
        isTree: Boolean(row.worktreePath) && row.worktreePath !== row.projectDir,
      });
    }
    // 「最近」组：最新对话在最前（lastActiveAt 由注册表维护，切换/收发消息都会 touch）
    const vdir = virtualProject?.path;
    if (vdir && map[vdir]) {
      map[vdir].sort((a, b) => (b.row.lastActiveAt ?? 0) - (a.row.lastActiveAt ?? 0));
    }
    return map;
  }, [convRows, firstUserById, unreadIds, metaMap, virtualProject, sessionsByProject]);

  /** 磁盘会话列表：被活跃对话认领的不重复展示；已归档的不在树里展示（设置「归档」页统一管理，T8.11-R2） */
  const activeSessionsByProject = useMemo(() => {
    // ⚠️ 2026-09-11 修：可隐掉会话行的只有「真的会渲染出一行」的对话——对话行的渲染条件是
    // firstUserById（有首条用户消息）且有会话文件、且未归档，与 conversationsByProject 完全同源。
    // 旧实现按「所有对话的 sessionFile」一律隐掉：对话行因缺首条消息不渲染时，磁盘会话行也被隐，
    // 该文件在左栏**彻底消失**（文件其实还在）→ 表现为「删了却还在、切一下就没了、重启又回来」的假象。
    const renderedByConv = new Set(
      convRows
        .filter((r) => r.sessionFile && firstUserById[r.id] && !metaMap[r.sessionFile]?.archived)
        .map((r) => r.sessionFile as string),
    );
    const next: Record<string, SessionItem[]> = {};
    for (const [path, sessions] of Object.entries(sessionsByProject)) {
      next[path] = sessions
        .filter((s) => !renderedByConv.has(s.file) && !metaMap[s.file]?.archived)
        // 置顶恒最前（T8.11），其余按最近修改
        .sort((a, b) => {
          const pa = metaMap[a.file]?.pinned ? 1 : 0;
          const pb = metaMap[b.file]?.pinned ? 1 : 0;
          if (pa !== pb) return pb - pa;
          return b.modified.localeCompare(a.modified);
        });
    }
    return next;
  }, [convRows, sessionsByProject, metaMap, firstUserById]);

  /**
   * 左栏单一列表（参考样式）：对话行与历史会话行不再分两段渲染——按「会话文件最近修改时间」
   * 统一倒序（置顶恒最前）。行 key = 会话文件路径：会话被对话认领时同一行原地从
   * 「会话行」换成「对话行」，位置与标题都不变，消除「点击后行飞到顶部」的跳动。
   */
  const treeRowsByProject = useMemo(() => {
    const modifiedByFile = new Map<string, string>();
    for (const list of Object.values(sessionsByProject)) for (const s of list) modifiedByFile.set(s.file, s.modified);
    const map: Record<string, SidebarRow[]> = {};
    const paths = new Set([...Object.keys(conversationsByProject), ...Object.keys(activeSessionsByProject)]);
    for (const path of paths) {
      const rows: SidebarRow[] = [
        // 对话行的时间取「所认领会话文件的 mtime」：点击前后是同一个值，标签不会从 4天 跳成 刚刚
        ...(conversationsByProject[path] ?? []).map((item): SidebarRow => {
          const file = item.row.sessionFile;
          const time =
            (file ? modifiedByFile.get(file) : undefined) ?? (item.row.lastActiveAt ? new Date(item.row.lastActiveAt).toISOString() : "");
          return { kind: "conv", key: file ?? item.row.id, time, item };
        }),
        ...(activeSessionsByProject[path] ?? []).map((session): SidebarRow => ({ kind: "session", key: session.file, time: session.modified, session })),
      ];
      rows.sort((a, b) => {
        const fileA = a.kind === "conv" ? a.item.row.sessionFile : a.session.file;
        const fileB = b.kind === "conv" ? b.item.row.sessionFile : b.session.file;
        const pinAOk = fileA && metaMap[fileA]?.pinned ? 1 : 0;
        const pinBOk = fileB && metaMap[fileB]?.pinned ? 1 : 0;
        if (pinAOk !== pinBOk) return pinBOk - pinAOk;
        return b.time.localeCompare(a.time);
      });
      map[path] = rows;
    }
    return map;
  }, [conversationsByProject, activeSessionsByProject, sessionsByProject, metaMap]);

  const selectConversation = useCallback((row: ConversationRow) => {
    setActiveSessionFile(undefined); // 直接点对话行：清掉上一条被点会话行的选中态，避免双高亮
    useConversationsStore.getState().switchTo(row.id, row.projectDir);
  }, []);

  return {
    projects,
    virtualProject,
    conversationsByProject,
    treeRowsByProject,
    sessionsByProject: activeSessionsByProject,
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
  };
}
