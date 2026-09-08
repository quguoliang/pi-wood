import { create } from "zustand";

/** 应用设置 store（T1.2）：加载 ~/.pi-wood/settings.json，布局变更防抖写回 */
export interface PiWoodSettings {
  window: { layout: [number, number, number]; leftCollapsed: boolean; rightCollapsed: boolean };
  theme: { fallback: "light" | "dark" | "system"; pi?: string };
  editor: { fontSize: number; tabSize: number };
  ui: { toolCardsDefaultOpen: boolean; thinkingDefaultOpen: boolean; toolGroupsEnabled: boolean; toolGroupsDefaultOpen: boolean };
  recentProjects: string[];
  /** T8.6/T8.11：工作树开关（设置「工作树」页可改；主进程 conversation-registry 读同一段配置） */
  worktree: { enabled: boolean; keepAfterClose: boolean };
  /** per-对话 Agent 权限档（conversationId → mode）；未列出的对话回退全局 approval.mode（主进程裁决）。 */
  approvalByConversation: Record<string, "auto" | "highRisk" | "allAsk" | "denyAll">;
  /** T7.2（已废弃）：旧「按会话自动接受」开关，仅历史数据兼容，裁决链不再消费。 */
  autoAcceptSessions: Record<string, boolean>;
}

export type ConversationApprovalMode = "auto" | "highRisk" | "allAsk" | "denyAll";

const defaults: PiWoodSettings = {
  window: { layout: [17, 55, 28], leftCollapsed: false, rightCollapsed: false },
  theme: { fallback: "dark" },
  editor: { fontSize: 14, tabSize: 2 },
  ui: { toolCardsDefaultOpen: false, thinkingDefaultOpen: false, toolGroupsEnabled: true, toolGroupsDefaultOpen: false },
  recentProjects: [],
  worktree: { enabled: true, keepAfterClose: false },
  approvalByConversation: {},
  autoAcceptSessions: {},
};

interface SettingsState {
  settings: PiWoodSettings;
  loaded: boolean;
  load(): Promise<void>;
  patch(patch: Record<string, unknown>): Promise<void>;
  setLayout(layout: [number, number, number]): void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

const merge = (raw: Partial<PiWoodSettings> | undefined): PiWoodSettings => ({
  ...defaults,
  ...raw,
  window: { ...defaults.window, ...raw?.window },
  theme: { ...defaults.theme, ...raw?.theme },
  editor: { ...defaults.editor, ...raw?.editor },
  ui: { ...defaults.ui, ...raw?.ui },
  worktree: { ...defaults.worktree, ...raw?.worktree },
  approvalByConversation: { ...defaults.approvalByConversation, ...raw?.approvalByConversation },
  autoAcceptSessions: { ...defaults.autoAcceptSessions, ...raw?.autoAcceptSessions },
});

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaults,
  loaded: false,
  async load() {
    const settings = (await window.pi.settingsGet()) as unknown as PiWoodSettings;
    set({ settings: merge(settings), loaded: true });
  },
  async patch(patch) {
    // 乐观更新：本地立即生效（UI 零延迟——折叠联动 header padding/接力图标必须同步，
    // 等 settingsSet IPC 往返会晚 ~200ms=动画中途换挡抖动），落盘后用主进程合并结果校正。
    const cur = get().settings as unknown as Record<string, object>;
    const raw: Record<string, unknown> = { ...cur };
    for (const [k, v] of Object.entries(patch)) {
      raw[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...cur[k], ...(v as object) } : v;
    }
    set({ settings: merge(raw as Partial<PiWoodSettings>) });
    const settings = (await window.pi.settingsSet(patch)) as unknown as PiWoodSettings;
    set({ settings: merge(settings) });
  },
  setLayout(layout) {
    set({ settings: { ...get().settings, window: { ...get().settings.window, layout } } });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void get().patch({ window: { layout } });
    }, 400);
  },
}));
