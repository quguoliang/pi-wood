import { create } from "zustand";
import {
  applyEngineEvent,
  emptySlice,
  mergeHistory,
  rebaseFromHistory,
  type ConversationItem,
  type ConversationSlice,
  type DiffStat,
  type HistoryMessageItem,
  type MessageAttachment,
  type MessageSnippet,
  type ToolStatus,
} from "./conversation-slice.ts";
import { useContextTreeStore } from "./context-tree-store.ts";
import { markSwitchStart } from "../lib/latency-outlet.ts";

/**
 * 会话 store（T8.3：slice-per-conversation）
 *
 * 一条对话一份状态（`slices[conversationId]`），归约逻辑全在 `conversation-slice.ts` 的纯函数里
 * （可穷举单测）。本文件只做三件事：**路由**（事件按 conversationId 进各自切片）、
 * **可见性**（谁是 active、unread 何时清零、历史何时装载）、**投递**（zustand 只写入变化的切片）。
 *
 * 三条硬约束（都被 conversation-slice.test.ts / 门禁盯着）：
 * 1. 后台对话的事件**不得**改动前台切片的任何字段 ⇒ 前台选择器不重渲染（T8.3 验收 4）。
 * 2. 归约返回 `changed:false` 时完全不 `set` ⇒ 空转不触发渲染。
 * 3. 丢事件不许静默：判给别家的计数（`foreignEventCount`）+ 断号计数（切片内 `droppedEvents`）都在状态里可观测。
 */

/** 还不知道 conversationId 时（legacy 裸事件 / 引擎未起）用的切片键 */
export const FALLBACK_SLICE_KEY = "";

/**
 * 稳定空切片：订阅读路径（sliceOf / useActiveConversation / useConversationSlice）的兜底值。
 * emptySlice() 每次调用都会新建 `items: []` 等数组，而 useSyncExternalStore 的 getSnapshot 按引用
 * 比较快照——若 activeConversationId 指向一条「尚未创建的切片」（引擎启动期 noteEventOwnership 直接
 * 采纳 active:true 戳置了 id、没建切片），数组/对象选择器每帧都拿到新引用 → 无限重渲染（React 报
 * 「getSnapshot should be cached」+ Maximum update depth exceeded → 白屏）。用单一常量保证同一状态恒等。
 */
const EMPTY_SLICE: ConversationSlice = emptySlice();

export type { ConversationItem, ConversationSlice, DiffStat, HistoryMessageItem, MessageAttachment, MessageSnippet, ToolStatus };

export interface EventMeta {
  conversationId: string | null;
  active?: boolean;
  legacy: boolean;
  seq?: number;
  /** child 世代号（child 重生后 seq 从 0 重计；渲染层据此重置对账基线） */
  epoch?: number;
}

interface SessionStoreState {
  slices: Record<string, ConversationSlice>;
  /** 用户正在看的对话；null = 尚未被告知（此时按 FALLBACK 切片工作，行为同 T8.2） */
  activeConversationId: string | null;
  /**
   * 草稿目标项目：activeConversationId=null 且此项非空 = 「正在起草一条新任务，
   * 但还没真正建对话」。点「+」进入此态，首次发送才 createConversation 物化（不提前 fork 引擎）。
   */
  draftProject: string | null;
  /** 判给别家对话、未进当前视图的事件计数（丢事件不许静默） */
  foreignEventCount: number;
  /** 当前项目（跨对话共享：左栏/右栏面板/终端都按项目取数） */
  activeProject: string | undefined;

  sliceOf(id?: string | null): ConversationSlice;
  handleEvent(e: Record<string, unknown>, meta?: EventMeta): void;
  /** T8.2 遗留入口：只记归属，不做路由（路由在 handleEvent 内） */
  noteEventOwnership(meta: EventMeta): void;
  /** 切换可见对话：清 unread、必要时整读历史并与已收增量对账；切到真实对话即退出草稿态 */
  setActiveConversation(id: string | null): void;
  /** 进入草稿态（不建对话、不 fork）：active=null + draftProject=dir */
  startDraft(projectDir: string): void;
  addUserMessage(text: string, conversationId?: string | null, meta?: { attachments?: MessageAttachment[]; snippets?: MessageSnippet[] }): void;
  /** 发送失败（引擎拉起失败等）时兜底清冷启动扫光——此路径没有引擎事件可清它 */
  clearWarming(conversationId?: string | null): void;
  loadHistory(items: HistoryMessageItem[], conversationId?: string | null): void;
  /** T9.2：切分支后按「当前视图叶」重读路径历史并整体换底（旁支条目消失，视图回到分支尾部） */
  rebaseToBranch(conversationId?: string | null): Promise<void>;
  markHistoryLoaded(conversationId?: string | null): void;
  setScrollTop(top: number, conversationId?: string | null): void;
  setFollowBottom(follow: boolean, conversationId?: string | null): void;
  setApprovalPending(pending: boolean, conversationId?: string | null): void;
  reset(conversationId?: string | null): void;
  setActiveProject(projectDir: string | undefined): void;
  setEngineReady(ready: boolean, conversationId?: string | null): void;
  refreshSessionId(conversationId?: string | null): Promise<void>;
}

let itemSeq = 0;
const nextItemId = (): string => `m${++itemSeq}`;

/** 正在装载历史的对话（防重入：切换抖动不会触发并发整读） */
const historyLoading = new Set<string>();

/**
 * 切到某对话时按需整读历史并与已收增量对账（⑤ 修复：此前注释承诺了「未装载先 loadMessages」
 * 但 setActiveConversation 从不执行——后台对话只有已收增量，历史缺口表现为「切换丢内容」）。
 * 会话文件缺席（新对话首轮消息未落盘）→ 直接标已装载，避免每次切换空查。
 */
async function ensureHistoryLoaded(id: string): Promise<void> {
  const slice = useSessionStore.getState().slices[id];
  if (!slice || slice.historyLoaded || historyLoading.has(id)) return;
  historyLoading.add(id);
  try {
    // ⚠ engine:listConversations 的载荷是 { conversations, capacity }（对象），行主键字段是 `id`——
    // 旧代码当数组按 r.conversationId 查，每切一条对话都静默 TypeError（ensureHistoryLoaded 被 void 吞），
    // 「切到后台对话整读对账」实际从未生效（T9.2 带窗探针首捕）。这里按真实形状解包。
    const payload = (await window.pi.listConversations?.().catch(() => undefined)) as
      | { conversations?: Array<{ id?: string; sessionFile?: string }> }
      | undefined;
    const rows = payload?.conversations ?? [];
    const sessionFile = rows.find((r) => r.id === id)?.sessionFile;
    if (!sessionFile) {
      useSessionStore.getState().markHistoryLoaded(id);
      return;
    }
    // T9.2：先刷树（sessions:tree）拿「当前视图叶」，历史按 root→leaf 路径过滤。
    // 树读取失败不拦历史装载（leafId=undefined → 主进程回旧行为全量文件序）。
    await useContextTreeStore.getState().refresh(id, sessionFile);
    const leafId = useContextTreeStore.getState().byConv[id]?.leafId;
    const messages = (await window.pi.sessionsMessages(sessionFile, leafId).catch(() => [])) as HistoryMessageItem[];
    useSessionStore.getState().loadHistory(messages, id);
  } finally {
    historyLoading.delete(id);
  }
}

/** 单对话最多在内存里留多少条 item（T8.3 步骤 6：N 路后台对话同时长跑不能吃穿堆） */
export const MAX_SLICE_ITEMS = 2000;

/**
 * 内存护栏：超上限只保留尾部，并累计被裁掉的头部条数（列表顶部据此给「上滑加载更早」入口）。
 * 放在 store 层而不是纯归约里——裁多少是渲染层策略，归约只管事件语义。
 */
function guardSliceMemory(slice: ConversationSlice): ConversationSlice {
  if (slice.items.length <= MAX_SLICE_ITEMS) return slice;
  const overflow = slice.items.length - MAX_SLICE_ITEMS;
  const items = slice.items.slice(overflow);
  return {
    ...slice,
    items,
    headTrimmed: slice.headTrimmed + overflow,
    runningToolCount: items.filter((i) => i.kind === "tool" && i.status === "running").length,
  };
}

const targetKeyOf = (state: { activeConversationId: string | null }, id: string | null | undefined): string =>
  id ?? state.activeConversationId ?? FALLBACK_SLICE_KEY;

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  slices: { [FALLBACK_SLICE_KEY]: emptySlice() },
  activeConversationId: null,
  draftProject: null,
  foreignEventCount: 0,
  activeProject: undefined,

  sliceOf(id) {
    const key = targetKeyOf(get(), id);
    return get().slices[key] ?? EMPTY_SLICE;
  },

  handleEvent(e, meta) {
    if (meta) get().noteEventOwnership(meta); // 先采纳归属再路由：漏调 noteEventOwnership 不该导致静默错路由
    const state = get();
    const key = targetKeyOf(state, meta?.conversationId);
    // 可见性以本地 active 为准：主进程的 active 戳在切换瞬间有 stale 窗口（发送时刻算的），
    // 若拿来当可见判据，旧对话在飞帧会被误判「正被看着」而不计未读。legacy 裸事件按可见处理（同 T8.2）。
    const visible = meta ? meta.legacy || !meta.conversationId || meta.conversationId === state.activeConversationId : true;
    const current = state.slices[key] ?? emptySlice();
    const result = applyEngineEvent(current, e, { now: Date.now(), nextId: nextItemId, visible, seq: meta?.seq, epoch: meta?.epoch });
    if (!result.changed) return; // 空转不 set ⇒ 不触发任何重渲染
    set({ slices: { ...state.slices, [key]: guardSliceMemory(result.slice) } });
  },

  noteEventOwnership(meta) {
    // 只在「从未选定」时采纳主进程的 active 戳（启动期 attach 恢复中的对话）。
    // 用户一旦选定，视图只跟用户走：主进程的 active 是**发送时刻**算的，切换瞬间在飞的
    // 旧对话帧仍带 active:true——照单全收会把 activeConversationId 拉回旧对话（视图错乱、
    // 看起来像「切换丢内容」）。
    if (meta.active === true && meta.conversationId && get().activeConversationId === null) {
      set({ activeConversationId: meta.conversationId });
    }
  },

  setActiveConversation(id) {
    const state = get();
    if (state.activeConversationId === id) {
      // 重复切到同一对话通常是 no-op；但若这条切片从未装载过历史/压根不存在——常见于引擎启动期
      // noteEventOwnership 采纳 active:true 戳直接置了 id、没走本函数的装载分支（T9.2 带窗探针首捕）——
      // 补建切片并装载（ensureHistoryLoaded 内部有 historyLoaded/loading 双闸，重复调用零成本）。
      if (id) {
        const s = state.slices[id];
        if (typeof window !== "undefined") {
          if (!s) set({ slices: { ...state.slices, [id]: emptySlice() } });
          if (!s || !s.historyLoaded) void ensureHistoryLoaded(id);
        }
      }
      return;
    }
    markSwitchStart(); // T8.10：首屏计时起点（App 在切换 effect 的下一帧配平）
    const key = id ?? FALLBACK_SLICE_KEY;
    const slice = state.slices[key] ?? emptySlice();
    set({
      activeConversationId: id,
      // 切到真实对话即退出草稿态；显式切到 null 不清（那是 startDraft 的语义）
      ...(id ? { draftProject: null } : {}),
      // 切过去即清零未读（T8.3 验收：未读计数在切过去时清零）
      slices: { ...state.slices, [key]: { ...slice, unreadCount: 0 } },
    });
    // 告知主进程（它据此做可见性节流 + 命令缺省归属）；失败不影响本地切换。
    // typeof 守卫是必需的：store 的纯状态部分要在 node --test 下可测（那里没有 window）。
    if (typeof window !== "undefined" && key) {
      void window.pi.setActiveConversation?.(key).catch(() => undefined);
      void ensureHistoryLoaded(key); // ⑤：未装载历史的对话切过去先整读对账，不再只显示已收增量
    }
  },

  startDraft(projectDir) {
    // 进入草稿态：不建对话、不 fork 引擎、不注册——只是「准备为该项目写一条新任务」。
    // activeConversationId=null 让视图走空切片（欢迎/起草屏）；draftProject 记下目标项目，
    // 首次发送时 conversations-store 才 createConversation 物化它。
    set({ activeConversationId: null, draftProject: projectDir, activeProject: projectDir });
  },

  addUserMessage(text, conversationId, meta) {
    const state = get();
    const key = targetKeyOf(state, conversationId);
    const current = state.slices[key] ?? emptySlice();
    const result = applyEngineEvent(
      current,
      {
        type: "user_message",
        text,
        ...(meta?.attachments?.length ? { attachments: meta.attachments } : {}),
        ...(meta?.snippets?.length ? { snippets: meta.snippets } : {}),
      },
      { now: Date.now(), nextId: nextItemId, visible: true },
    );
    set({ slices: { ...state.slices, [key]: result.slice } });
  },

  clearWarming(conversationId) {
    const state = get();
    const key = targetKeyOf(state, conversationId);
    const current = state.slices[key];
    if (!current?.warming) return;
    set({ slices: { ...state.slices, [key]: { ...current, warming: false } } });
  },

  loadHistory(items, conversationId) {
    const state = get();
    const key = targetKeyOf(state, conversationId);
    const current = state.slices[key] ?? emptySlice();
    const { slice } = mergeHistory(current, items, { now: Date.now(), nextId: nextItemId });
    set({ slices: { ...state.slices, [key]: slice } });
  },

  async rebaseToBranch(conversationId) {
    const state = get();
    const key = targetKeyOf(state, conversationId);
    const tree = useContextTreeStore.getState().byConv[key];
    if (!tree?.file) return; // 还没有会话文件（空对话）：无分支可换，静默返回
    const messages = (await window.pi.sessionsMessages(tree.file, tree.leafId).catch(() => [])) as HistoryMessageItem[];
    const s2 = get();
    const cur = s2.slices[key] ?? emptySlice();
    const slice = rebaseFromHistory(cur, messages, { now: Date.now(), nextId: nextItemId });
    set({ slices: { ...s2.slices, [key]: slice } });
  },

  markHistoryLoaded(conversationId) {
    const state = get();
    const key = targetKeyOf(state, conversationId);
    const current = state.slices[key] ?? emptySlice();
    set({ slices: { ...state.slices, [key]: { ...current, historyLoaded: true } } });
  },

  setScrollTop(top, conversationId) {
    const state = get();
    const key = targetKeyOf(state, conversationId);
    const current = state.slices[key] ?? emptySlice();
    if (current.scrollTop === top) return;
    set({ slices: { ...state.slices, [key]: { ...current, scrollTop: top } } });
  },

  setFollowBottom(follow, conversationId) {
    const state = get();
    const key = targetKeyOf(state, conversationId);
    const current = state.slices[key] ?? emptySlice();
    if (current.followBottom === follow) return;
    set({ slices: { ...state.slices, [key]: { ...current, followBottom: follow } } });
  },

  setApprovalPending(pending, conversationId) {
    const state = get();
    const key = targetKeyOf(state, conversationId);
    const current = state.slices[key] ?? emptySlice();
    set({ slices: { ...state.slices, [key]: { ...current, hasPendingApproval: pending } } });
  },

  reset(conversationId) {
    const state = get();
    const key = targetKeyOf(state, conversationId);
    set({ slices: { ...state.slices, [key]: emptySlice() } });
  },

  setActiveProject(projectDir) {
    // 只记「当前项目」：多对话并存后，某条对话的会话身份属于它自己那条切片，
    // 在这里清 currentSessionId 会把别的项目的对话清懵（会话状态由事件流与 refreshSessionId 维护）。
    set({ activeProject: projectDir });
  },

  setEngineReady(ready, conversationId) {
    const state = get();
    const key = targetKeyOf(state, conversationId);
    const current = state.slices[key] ?? emptySlice();
    if (current.engineReady === ready) return;
    set({ slices: { ...state.slices, [key]: { ...current, engineReady: ready } } });
  },

  async refreshSessionId(conversationId) {
    const state = await window.pi.engineState().catch(() => undefined);
    const g = get();
    const key = targetKeyOf(g, conversationId);
    const current = g.slices[key] ?? emptySlice();
    if (current.currentSessionId === state?.sessionId) return;
    set({ slices: { ...g.slices, [key]: { ...current, currentSessionId: state?.sessionId } } });
  },
}));

/**
 * 取「当前可见对话」的切片视图（消费者一律走这两个 hook，不再直接读顶层字段）。
 *
 * 为什么用 selector 而不是把切片字段摊平到顶层：摊平后任何后台对话的事件都会改动顶层引用，
 * 前台组件必然重渲染——那正是 T8.3 验收 4 要禁掉的事。
 */
export function useActiveConversation<T>(selector: (slice: ConversationSlice) => T): T {
  return useSessionStore((state) => selector(state.slices[state.activeConversationId ?? FALLBACK_SLICE_KEY] ?? EMPTY_SLICE));
}

/** 取指定对话的切片（多对话标签条/后台摘要用；id 为 null 时退到 active） */
export function useConversationSlice<T>(id: string | null | undefined, selector: (slice: ConversationSlice) => T): T {
  return useSessionStore((state) => selector(state.slices[id ?? state.activeConversationId ?? FALLBACK_SLICE_KEY] ?? EMPTY_SLICE));
}

/** 非 hook 场景（事件回调里）读当前可见切片 */
export function activeSlice(): ConversationSlice {
  return useSessionStore.getState().sliceOf(null);
}
