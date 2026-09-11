import { create } from "zustand";
import { useSettingsStore } from "./settings-store";

/** 新建会话时用户/策略选定的工作区。 */
export type WorktreeChoice = "worktree" | "current";

/**
 * 「新任务在哪个工作区继续」选择弹框的驱动 store（Promise resolver 形态）。
 *
 * 为什么用 Promise + resolver 而不是纯状态机：新建会话的工作区选择发生在 `send()` 里
 * `await createConversation(...)` **之前**，需要拿到用户选择再继续——send 本就是 async，
 * 天然可以 `await askWorktreeChoice(dir)`。组件（WorktreeAskDialog）读 open/branch 渲染，
 * 用户点按钮时调用 answer() 兑现 promise。
 */
interface WorktreeAskState {
  open: boolean;
  projectDir: string | null;
  branch: string;
  resolve?: (choice: WorktreeChoice) => void;
  /** 打开弹框，等待用户决定。 */
  prompt(projectDir: string, branch: string): Promise<WorktreeChoice>;
  /** 用户做出选择；remember=true 时把该选择回落到全局 worktree.mode（以后不再问）。 */
  answer(choice: WorktreeChoice, remember: boolean): void;
}

export const useWorktreeAskStore = create<WorktreeAskState>((set, get) => ({
  open: false,
  projectDir: null,
  branch: "",
  prompt(projectDir, branch) {
    return new Promise<WorktreeChoice>((resolve) => set({ open: true, projectDir, branch, resolve }));
  },
  answer(choice, remember) {
    const { resolve } = get();
    set({ open: false, projectDir: null, branch: "", resolve: undefined });
    if (remember) void useSettingsStore.getState().patch({ worktree: { mode: choice } });
    resolve?.(choice);
  },
}));

/**
 * 新建会话前决定工作区策略：
 * - 全局 mode=worktree/current → 直接采用，不查不问；
 * - mode=ask → 查主工作树 git 状态：非 git / 不可建 worktree / 干净（无未提交改动）→ 用当前分支（不建，无风险）；
 *   仅当主树「有未提交改动且能建 worktree」时才弹框让用户在「当前分支 / 独立工作树」间选择。
 */
export async function resolveWorktreeChoice(projectDir: string | undefined): Promise<WorktreeChoice> {
  const mode = useSettingsStore.getState().settings.worktree.mode;
  if (mode === "worktree") return "worktree";
  if (mode === "current") return "current";
  if (!projectDir) return "current";
  let st: { isGit?: boolean; dirty?: boolean; feasible?: boolean; branch?: string } | undefined;
  try {
    st = (await window.pi.mainGitStatus?.(projectDir)) as typeof st;
  } catch {
    return "current"; // 查询失败保守走当前分支（不建任何树，无破坏性）
  }
  if (!st || !st.isGit || !st.feasible || !st.dirty) return "current";
  return useWorktreeAskStore.getState().prompt(projectDir, st.branch ?? "");
}
