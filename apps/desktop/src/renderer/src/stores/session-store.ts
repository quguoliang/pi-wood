import { create } from "zustand";
import {
  applyEngineEvent,
  emptySlice,
  mergeHistory,
  type ConversationItem,
  type ConversationSlice,
  type DiffStat,
  type HistoryMessageItem,
  type ToolStatus,
} from "./conversation-slice.ts";

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

export type { ConversationItem, ConversationSlice, DiffStat, HistoryMessageItem, ToolStatus };

export interface EventMeta {
  conversationId: string | null;
  active?: boolean;
  legacy: boolean;
  seq?: number;
}

interface SessionStoreState {
  slices: Record<string, ConversationSlice>;
  /** 用户正在看的对话；null = 尚未被告知（此时按 FALLBACK 切片工作，行为同 T8.2） */
  activeConversationId: string | null;
  /** 判给别家对话、未进当前视图的事件计数（丢事件不许静默） */
  foreignEventCount: number;
  /** 当前项目（跨对话共享：左栏/右栏面板/终端都按项目取数） */
  activeProject: string | undefined;

  sliceOf(id?: string | null): ConversationSlice;
  handleEvent(e: Record<string, unknown>, meta?: EventMeta): void;
  /** T8.2 遗留入口：只记归属，不做路由（路由在 handleEvent 内） */
  noteEventOwnership(meta: EventMeta): void;
  /** 切换可见对话：清 unread、必要时整读历史并与已收增量对账 */
  setActiveConversation(id: string | null): void;
  addUserMessage(text: string, conversationId?: string | null): void;
  loadHistory(items: HistoryMessageItem[], conversationId?: string | null): void;
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
  foreignEventCount: 0,
  activeProject: undefined,

  sliceOf(id) {
    const key = targetKeyOf(get(), id);
    return get().slices[key] ?? emptySlice();
  },

  handleEvent(e, meta) {
    if (meta) get().noteEventOwnership(meta); // 先采纳归属再路由：漏调 noteEventOwnership 不该导致静默错路由
    const state = get();
    const key = targetKeyOf(state, meta?.conversationId);
    // legacy 裸事件（无归属）与「主进程盖了 active」都算正被看着；其余按 activeConversationId 比
    const visible = meta ? meta.active === true || meta.legacy || !meta.conversationId : true;
    const current = state.slices[key] ?? emptySlice();
    const result = applyEngineEvent(current, e, { now: Date.now(), nextId: nextItemId, visible, seq: meta?.seq });
    if (!result.changed) return; // 空转不 set ⇒ 不触发任何重渲染
    set({ slices: { ...state.slices, [key]: guardSliceMemory(result.slice) } });
  },

  noteEventOwnership(meta) {
    if (meta.active === true && meta.conversationId && meta.conversationId !== get().activeConversationId) {
      set({ activeConversationId: meta.conversationId });
    }
  },

  setActiveConversation(id) {
    const state = get();
    if (state.activeConversationId === id) return;
    const key = id ?? FALLBACK_SLICE_KEY;
    const slice = state.slices[key] ?? emptySlice();
    set({
      activeConversationId: id,
      // 切过去即清零未读（T8.3 验收：未读计数在切过去时清零）
      slices: { ...state.slices, [key]: { ...slice, unreadCount: 0 } },
    });
    // 告知主进程（它据此做可见性节流 + 命令缺省归属）；失败不影响本地切换。
    // typeof 守卫是必需的：store 的纯状态部分要在 node --test 下可测（那里没有 window）。
    if (typeof window !== "undefined" && key) {
      void window.pi.setActiveConversation?.(key).catch(() => undefined);
    }
  },

  addUserMessage(text, conversationId) {
    const state = get();
    const key = targetKeyOf(state, conversationId);
    const current = state.slices[key] ?? emptySlice();
    const result = applyEngineEvent(current, { type: "user_message", text }, { now: Date.now(), nextId: nextItemId, visible: true });
    set({ slices: { ...state.slices, [key]: result.slice } });
  },

  loadHistory(items, conversationId) {
    const state = get();
    const key = targetKeyOf(state, conversationId);
    const current = state.slices[key] ?? emptySlice();
    const { slice } = mergeHistory(current, items, { now: Date.now(), nextId: nextItemId });
    set({ slices: { ...state.slices, [key]: slice } });
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
  return useSessionStore((state) => selector(state.slices[state.activeConversationId ?? FALLBACK_SLICE_KEY] ?? emptySlice()));
}

/** 取指定对话的切片（多对话标签条/后台摘要用；id 为 null 时退到 active） */
export function useConversationSlice<T>(id: string | null | undefined, selector: (slice: ConversationSlice) => T): T {
  return useSessionStore((state) => selector(state.slices[id ?? state.activeConversationId ?? FALLBACK_SLICE_KEY] ?? emptySlice()));
}

/** 非 hook 场景（事件回调里）读当前可见切片 */
export function activeSlice(): ConversationSlice {
  return useSessionStore.getState().sliceOf(null);
}
