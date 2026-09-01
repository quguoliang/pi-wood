import { create } from "zustand";

/** 应用设置 store（T1.2）：加载 ~/.pi-wood/settings.json，布局变更防抖写回 */
export interface PiWoodSettings {
  window: { layout: [number, number, number]; leftCollapsed: boolean; rightCollapsed: boolean };
  theme: { fallback: "light" | "dark" | "system" };
  editor: { fontSize: number; tabSize: number };
  ui: { toolCardsDefaultOpen: boolean; thinkingDefaultOpen: boolean };
  recentProjects: string[];
}

const defaults: PiWoodSettings = {
  window: { layout: [17, 55, 28], leftCollapsed: false, rightCollapsed: false },
  theme: { fallback: "dark" },
  editor: { fontSize: 14, tabSize: 2 },
  ui: { toolCardsDefaultOpen: false, thinkingDefaultOpen: false },
  recentProjects: [],
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
