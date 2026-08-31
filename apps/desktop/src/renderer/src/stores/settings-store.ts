import { create } from "zustand";

/** 应用设置 store（T1.2）：加载 ~/.pi-wood/settings.json，布局变更防抖写回 */
export interface pi-woodSettings {
  window: { layout: [number, number, number]; rightCollapsed: boolean };
  theme: { fallback: "light" | "dark" | "system" };
  editor: { fontSize: number; tabSize: number };
  recentProjects: string[];
}

const defaults: pi-woodSettings = {
  window: { layout: [22, 48, 30], rightCollapsed: false },
  theme: { fallback: "dark" },
  editor: { fontSize: 14, tabSize: 2 },
  recentProjects: [],
};

interface SettingsState {
  settings: pi-woodSettings;
  loaded: boolean;
  load(): Promise<void>;
  patch(patch: Record<string, unknown>): Promise<void>;
  setLayout(layout: [number, number, number]): void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaults,
  loaded: false,
  async load() {
    const settings = (await window.pi.settingsGet()) as unknown as pi-woodSettings;
    set({ settings: { ...defaults, ...settings }, loaded: true });
  },
  async patch(patch) {
    const settings = (await window.pi.settingsSet(patch)) as unknown as pi-woodSettings;
    set({ settings: { ...defaults, ...settings } });
  },
  setLayout(layout) {
    set({ settings: { ...get().settings, window: { ...get().settings.window, layout } } });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void get().patch({ window: { layout } });
    }, 400);
  },
}));
