import { create } from "zustand";
import { toast } from "sonner";
import { useSessionStore } from "./session-store";
import type { ConversationStatus } from "./conversation-badge";

/**
 * 对话注册表的渲染层单一订阅源（原 T8.8 ConversationTabs 的轮询迁移至此）：
 * - 左栏项目树（①③④：对话归组 + 状态圆点）与 App 级快捷键共用同一条轮询，不再双份拉取；
 * - unread 集合与「首条用户消息」经**粗粒度差分**进状态：token 级切片写入不会让左栏重渲染，
 *   只有「哪些对话有未读」这个集合本身变化（里程碑边界）才 set——T8.3 的验收 4 在左栏同样成立。
 */

export interface ConversationRow {
  id: string;
  status: ConversationStatus;
  projectDir: string;
  inFlightPrompt: boolean;
  pendingApprovals: number;
  worktreePath?: string;
  /** 该对话当前 Pi 会话文件（首轮消息落盘前缺席）；左栏树行 ↔ 磁盘会话去重的映射键 */
  sessionFile?: string;
  epoch?: number;
}

interface PendingClose {
  conversationId: string;
  busy: boolean;
}

interface ConversationsState {
  rows: ConversationRow[];
  /** 有未读的对话 id 集合（蓝点：任务完成未查看；切过去即从集合移除） */
  unreadIds: Set<string>;
  /** 对话 id → 首条用户消息（树行标题；未落消息的对话缺省，回落 tabTitle 的项目名兜底） */
  firstUserById: Record<string, string | undefined>;
  pendingClose: PendingClose | null;
  refresh(): Promise<void>;
  switchTo(id: string, projectDir?: string): void;
  /**
   * 「+ 新任务」入口：不建对话、不 fork。
   * - 当前活跃对话就是目标项目的空草稿（还没发过消息）→ 直接复用它（聚焦输入框即可）；
   * - 否则进入草稿态（active=null + draftProject），首次发送时才 createConversation 物化。
   */
  startDraft(projectDir?: string): void;
  /** 物化一条新对话并设为活跃（草稿首次发送时调用） */
  createConversation(projectDir?: string): Promise<void>;
  requestClose(row: ConversationRow): Promise<void>;
  dismissClose(): void;
  resolvePendingClose(mode: "suspend" | "abort"): Promise<void>;
}

export const useConversationsStore = create<ConversationsState>((set, get) => ({
  rows: [],
  unreadIds: new Set<string>(),
  firstUserById: {},
  pendingClose: null,

  async refresh() {
    try {
      const r = (await window.pi.listConversations?.()) as { conversations?: ConversationRow[] } | undefined;
      if (r?.conversations) set({ rows: r.conversations });
    } catch {
      /* 引擎未起时静默 */
    }
  },

  switchTo(id, projectDir) {
    const st = useSessionStore.getState();
    if (projectDir && st.activeProject !== projectDir) st.setActiveProject(projectDir);
    st.setActiveConversation(id);
  },

  startDraft(projectDir) {
    const sess = useSessionStore.getState();
    const dir = projectDir ?? sess.draftProject ?? sess.activeProject;
    if (!dir) return;
    // 当前活跃对话若正是本项目的空草稿（还没发过任何用户消息）→ 复用它，聚焦输入框即可，
    // 既不新建对话也不 fork 引擎（避免「点一下 + 就凭空多一个任务」）。
    const activeId = sess.activeConversationId;
    if (activeId) {
      const row = get().rows.find((r) => r.id === activeId);
      const isEmptyDraft = !get().firstUserById[activeId];
      const sameProject = !row || row.projectDir === dir;
      if (isEmptyDraft && sameProject) {
        if (typeof window !== "undefined") window.dispatchEvent(new Event("piwood:composer-focus"));
        return;
      }
    }
    sess.startDraft(dir);
    if (typeof window !== "undefined") window.dispatchEvent(new Event("piwood:composer-focus"));
  },

  async createConversation(projectDir) {
    const dir = projectDir ?? useSessionStore.getState().activeProject ?? useSessionStore.getState().draftProject ?? undefined;
    if (!dir) return;
    try {
      const r = (await window.pi.createConversation?.(dir)) as { conversationId?: string } | undefined;
      if (r?.conversationId) get().switchTo(r.conversationId, dir);
      await get().refresh();
    } catch (err) {
      toast(`新建对话失败：${err instanceof Error ? err.message : String(err)}`);
    }
  },

  async requestClose(row) {
    const busy = row.status === "streaming" || row.inFlightPrompt || row.pendingApprovals > 0;
    if (busy) {
      set({ pendingClose: { conversationId: row.id, busy } });
      return;
    }
    await window.pi.closeConversation?.(row.id);
    toast("对话已关闭");
    void get().refresh();
  },

  dismissClose() {
    set({ pendingClose: null });
  },

  async resolvePendingClose(mode) {
    const p = get().pendingClose;
    set({ pendingClose: null });
    if (!p) return;
    if (mode === "suspend") {
      // 关停引擎但保留可恢复：suspend 只优雅退出 child，sessionFile 保留，切回/再开自动接回上下文
      await window.pi.suspendConversation?.(p.conversationId);
      toast("引擎已关停，上下文保留（切回该对话自动恢复）");
    } else {
      // 中止任务：先 abort 当前轮再 close（worktree 未回流改动会保留并提示）
      try {
        await window.pi.engineAbort();
      } catch {
        /* 已在收尾的引擎 abort 可能失败，忽略 */
      }
      await window.pi.closeConversation?.(p.conversationId);
      toast("任务已中止，对话已关闭", { description: "工作树未回流改动已保留，可稍后手工处理" });
    }
    void get().refresh();
  },
}));

/* ---------- 单轮询 + 粗粒度差分（模块级副作用仅在渲染层进程存在） ---------- */

let started = false;

export function startConversationsPolling(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void useConversationsStore.getState().refresh();
  setInterval(() => void useConversationsStore.getState().refresh(), 1500);

  let lastUnreadKey = "__init__";
  let lastTitleKey = "__init__";
  useSessionStore.subscribe((s) => {
    const entries = Object.entries(s.slices);
    const unreadKey = entries
      .filter(([, v]) => v.unreadCount > 0)
      .map(([k]) => k)
      .sort()
      .join(",");
    if (unreadKey !== lastUnreadKey) {
      lastUnreadKey = unreadKey;
      useConversationsStore.setState({ unreadIds: new Set(unreadKey ? unreadKey.split(",") : []) });
    }
    const titleKey = entries
      .map(([k, v]) => {
        const first = v.items.find((i) => i.kind === "user");
        return `${k}=${first && first.kind === "user" ? first.text : ""}`;
      })
      .sort()
      .join("|");
    if (titleKey !== lastTitleKey) {
      lastTitleKey = titleKey;
      const next: Record<string, string | undefined> = {};
      for (const [k, v] of entries) {
        const first = v.items.find((i) => i.kind === "user");
        if (first && first.kind === "user") next[k] = first.text;
      }
      useConversationsStore.setState({ firstUserById: next });
    }
  });
}
