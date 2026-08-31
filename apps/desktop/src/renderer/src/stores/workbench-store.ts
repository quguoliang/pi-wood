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
  addDiff: (diff: DiffItem) => void;
  removeDiff: (id: string) => void;
  requestFile: (path: string) => void;
  clearRequestedFile: () => void;
}

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  diffs: [],
  addDiff: (diff) => set((state) => ({ diffs: [...state.diffs, diff] })),
  removeDiff: (id) => set((state) => ({ diffs: state.diffs.filter((diff) => diff.id !== id) })),
  requestFile: (path) => set({ requestedFile: path }),
  clearRequestedFile: () => set({ requestedFile: undefined }),
}));

export function openWorkbench(tab: WorkbenchTab): void {
  window.dispatchEvent(new CustomEvent<WorkbenchTab>("piwood:open-workbench", { detail: tab }));
}

export function openWorkbenchFile(path: string): void {
  useWorkbenchStore.getState().requestFile(path);
  openWorkbench("files");
}
