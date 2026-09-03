import { create } from "zustand";
import type { PluginPanelEntry, PluginStatus, PluginStatusItem } from "@pi-wood/ipc-schema";

/**
 * T5.2 插件系统渲染层 store。
 * - list：PluginHost 推的每插件状态快照（含 activity 时间线）。
 * - panels / statusbar：插件注册进来的面板 / 状态栏项（宿主推快照）。
 * 动作都是 window.pi.* 的薄封装，成功后用返回值刷新 list。
 */
interface PluginState {
  list: PluginStatus[];
  panels: PluginPanelEntry[];
  statusbar: PluginStatusItem[];
  loaded: boolean;
  refresh: () => Promise<void>;
  setList: (list: PluginStatus[]) => void;
  setPanels: (panels: PluginPanelEntry[]) => void;
  setStatusbar: (items: PluginStatusItem[]) => void;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  restart: (id: string) => Promise<void>;
  reload: () => Promise<void>;
  demo: (kind: "crash" | "overreach") => Promise<void>;
}

export const usePluginStore = create<PluginState>((set) => ({
  list: [],
  panels: [],
  statusbar: [],
  loaded: false,
  refresh: async () => {
    const list = await window.pi.pluginsList();
    set({ list, loaded: true });
  },
  setList: (list) => set({ list, loaded: true }),
  setPanels: (panels) => set({ panels }),
  setStatusbar: (statusbar) => set({ statusbar }),
  setEnabled: async (id, enabled) => {
    const list = await window.pi.pluginsSetEnabled(id, enabled);
    set({ list });
  },
  restart: async (id) => {
    const list = await window.pi.pluginsRestart(id);
    set({ list });
  },
  reload: async () => {
    const list = await window.pi.pluginsReload();
    set({ list });
  },
  demo: async (kind) => {
    await window.pi.pluginsDemo(kind);
    // 崩溃/拒绝会经 plugins:status 推送回流，稍后再主动拉一次兜底
    setTimeout(async () => set({ list: await window.pi.pluginsList() }), 900);
  },
}));
