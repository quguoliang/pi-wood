import { create } from "zustand";

/**
 * 工作台状态（T8.7 步骤 4：per-对话切片）。
 *
 * 内部按 `conversationId → Slice` 存储多套标签/差异/请求文件；顶层 `diffs/openTabs/activeTab/
 * requestedFile` 字段是**当前对话切片的投影**——既有消费者（RightPane/FilesPanel/DiffPanel）
 * 的读路径零改动。写入 action 带可选 `conversationId`（缺省=当前对话），跨对话事件（如后台
 * 对话的 edit/write diff）按归属路由进各自切片；`switchConversation` 切换投影（切片常驻内存，
 * 已开面板状态不销毁）。
 */
export type WorkbenchTab = "files" | "term" | "browser" | "diff" | "btw" | "subagent";

export interface DiffItem {
  id?: string;
  file: string;
  before?: string;
  after?: string;
  patch?: string;
  /** T8.7：产生该差异的对话（后台对话的 edit/write 也按归属落各自切片） */
  conversationId?: string;
}

export interface RequestedFile {
  path: string;
  line?: number;
}

interface WorkbenchSlice {
  diffs: DiffItem[];
  requestedFile?: RequestedFile;
  openTabs: WorkbenchTab[];
  activeTab: WorkbenchTab | null;
}

interface WorkbenchState extends WorkbenchSlice {
  /** T8.7：conversationId → 各对话独立的标签/差异/请求文件（顶层字段=当前对话的投影） */
  slices: Record<string, WorkbenchSlice>;
  conversationId: string | null;
  addDiff: (diff: DiffItem, conversationId?: string | null) => void;
  removeDiff: (id: string) => void;
  requestFile: (path: string, line?: number, conversationId?: string | null) => void;
  clearRequestedFile: () => void;
  openTab: (tab: WorkbenchTab) => void;
  closeTab: (tab: WorkbenchTab) => void;
  setActiveTab: (tab: WorkbenchTab) => void;
  hydrateTabs: (tabs: WorkbenchTab[], active: WorkbenchTab | null) => void;
  /** 切换对话：顶层投影切到该对话的切片（切片不存在则建空套） */
  switchConversation: (conversationId: string | null) => void;
}

const ALL_TABS: WorkbenchTab[] = ["files", "term", "browser", "diff", "btw", "subagent"];
const FALLBACK_KEY = "__global__";

function emptySlice(): WorkbenchSlice {
  return { diffs: [], requestedFile: undefined, openTabs: [], activeTab: null };
}

function keyOf(id: string | null | undefined): string {
  return id ?? FALLBACK_KEY;
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => {
  /** 更新某个切片并把「当前对话」的切片投影到顶层 */
  const mutate = (conversationId: string | null | undefined, fn: (s: WorkbenchSlice) => WorkbenchSlice): void => {
    const state = get();
    const key = keyOf(conversationId ?? state.conversationId);
    const slices = { ...state.slices };
    slices[key] = fn(slices[key] ?? emptySlice());
    const currentKey = keyOf(state.conversationId);
    const projected = slices[currentKey] ?? emptySlice();
    set({ slices, ...projected });
  };

  return {
    slices: {},
    conversationId: null,
    diffs: [],
    requestedFile: undefined,
    openTabs: [],
    activeTab: null,

    addDiff: (diff, conversationId) =>
      mutate(conversationId, (s) => ({ ...s, diffs: [...s.diffs, diff] })),
    removeDiff: (id) =>
      mutate(undefined, (s) => ({ ...s, diffs: s.diffs.filter((diff) => diff.id !== id) })),
    requestFile: (path, line, conversationId) =>
      mutate(conversationId, (s) => ({ ...s, requestedFile: { path, line } })),
    clearRequestedFile: () =>
      mutate(undefined, (s) => ({ ...s, requestedFile: undefined })),

    openTab: (tab) => {
      // 打开面板时确保右侧栏可见（收起态自动展开）
      window.dispatchEvent(new Event("piwood:reveal-inspector"));
      mutate(undefined, (s) => {
        if (s.openTabs.includes(tab)) return { ...s, activeTab: tab };
        return { ...s, openTabs: [...s.openTabs, tab], activeTab: tab };
      });
    },
    closeTab: (tab) =>
      mutate(undefined, (s) => {
        if (!s.openTabs.includes(tab)) return s;
        const next = s.openTabs.filter((t) => t !== tab);
        let nextActive = s.activeTab;
        if (s.activeTab === tab) {
          const idx = s.openTabs.indexOf(tab);
          nextActive = next[Math.min(idx, next.length - 1)] ?? null;
        }
        return { ...s, openTabs: next, activeTab: nextActive };
      }),
    setActiveTab: (tab) => mutate(undefined, (s) => ({ ...s, activeTab: tab })),
    hydrateTabs: (tabs, active) =>
      mutate(undefined, (s) => {
        const valid = tabs.filter((t): t is WorkbenchTab => ALL_TABS.includes(t));
        const uniq = [...new Set(valid)];
        return {
          ...s,
          openTabs: uniq,
          activeTab: active && uniq.includes(active) ? active : uniq[uniq.length - 1] ?? null,
        };
      }),
    switchConversation: (conversationId) => {
      const state = get();
      const key = keyOf(conversationId);
      if (state.conversationId === conversationId) return;
      const slices = { ...state.slices };
      const next = slices[key] ?? emptySlice();
      slices[key] = next;
      set({ slices, conversationId, ...next });
    },
  };
});

export function openWorkbench(tab: WorkbenchTab): void {
  useWorkbenchStore.getState().openTab(tab);
}

export function openWorkbenchFile(path: string, line?: number): void {
  useWorkbenchStore.getState().requestFile(path, line);
  openWorkbench("files");
}
