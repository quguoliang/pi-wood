import { create } from "zustand";

/** 应用设置 store（T1.2）：加载 ~/.pi-wood/settings.json，布局变更防抖写回 */
export interface PiWoodSettings {
  window: { layout: [number, number, number]; leftCollapsed: boolean; rightCollapsed: boolean };
  theme: { fallback: "light" | "dark" | "system"; pi?: string };
  editor: { fontSize: number; tabSize: number };
  ui: { toolCardsDefaultOpen: boolean; thinkingDefaultOpen: boolean; toolGroupsEnabled: boolean; toolGroupsDefaultOpen: boolean };
  recentProjects: string[];
  /** T7.2：按会话 id 记录「自动接受审批」开关（与主进程 settings 同源）。 */
  autoAcceptSessions: Record<string, boolean>;
}

const defaults: PiWoodSettings = {
  window: { layout: [17, 55, 28], leftCollapsed: false, rightCollapsed: false },
  theme: { fallback: "dark" },
  editor: { fontSize: 14, tabSize: 2 },
  ui: { toolCardsDefaultOpen: false, thinkingDefaultOpen: false, toolGroupsEnabled: true, toolGroupsDefaultOpen: false },
  recentProjects: [],
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
