import { create } from "zustand";

export type WorkbenchTab = "files" | "term" | "browser" | "diff";

export interface DiffItem {
  id?: string;
  file: string;
  before?: string;
  after?: string;
  patch?: string;
}

interface WorkbenchState {
  diffs: DiffItem[];
  requestedFile?: string;
  /** Chrome 式右侧栏：已打开的面板（顺序即标签顺序）与当前激活项。空数组 → 显示启动器。 */
  openTabs: WorkbenchTab[];
  activeTab: WorkbenchTab | null;
  addDiff: (diff: DiffItem) => void;
  removeDiff: (id: string) => void;
  requestFile: (path: string) => void;
  clearRequestedFile: () => void;
  openTab: (tab: WorkbenchTab) => void;
  closeTab: (tab: WorkbenchTab) => void;
  setActiveTab: (tab: WorkbenchTab) => void;
  hydrateTabs: (tabs: WorkbenchTab[], active: WorkbenchTab | null) => void;
}

const ALL_TABS: WorkbenchTab[] = ["files", "term", "browser", "diff"];

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  diffs: [],
  addDiff: (diff) => set((state) => ({ diffs: [...state.diffs, diff] })),
  removeDiff: (id) => set((state) => ({ diffs: state.diffs.filter((diff) => diff.id !== id) })),
  requestFile: (path) => set({ requestedFile: path }),
  clearRequestedFile: () => set({ requestedFile: undefined }),

  openTabs: [],
  activeTab: null,

  openTab: (tab) => {
    // 打开面板时确保右侧栏可见（收起态自动展开）
    window.dispatchEvent(new Event("piwood:reveal-inspector"));
    const { openTabs } = get();
    if (openTabs.includes(tab)) {
      set({ activeTab: tab });
      return;
    }
    set({ openTabs: [...openTabs, tab], activeTab: tab });
  },
  closeTab: (tab) => {
    const { openTabs, activeTab } = get();
    if (!openTabs.includes(tab)) return;
    const next = openTabs.filter((t) => t !== tab);
    let nextActive = activeTab;
    if (activeTab === tab) {
      const idx = openTabs.indexOf(tab);
      nextActive = next[Math.min(idx, next.length - 1)] ?? null;
    }
    set({ openTabs: next, activeTab: nextActive });
  },
  setActiveTab: (tab) => set({ activeTab: tab }),
  hydrateTabs: (tabs, active) => {
    const valid = tabs.filter((t): t is WorkbenchTab => ALL_TABS.includes(t));
    const uniq = [...new Set(valid)];
    set({ openTabs: uniq, activeTab: active && uniq.includes(active) ? active : uniq[uniq.length - 1] ?? null });
  },
}));

export function openWorkbench(tab: WorkbenchTab): void {
  useWorkbenchStore.getState().openTab(tab);
}

export function openWorkbenchFile(path: string): void {
  useWorkbenchStore.getState().requestFile(path);
  openWorkbench("files");
}
