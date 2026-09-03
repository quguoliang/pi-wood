import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { ipcMain } from "electron";

// 与 project-manager.ts 的 DEFAULT_APP_DATA_DIR 保持一致（~/.pi-wood）
const APP_DATA_DIR = join(process.env["USERPROFILE"] ?? process.env["HOME"] ?? ".", ".pi-wood");

/**
 * 应用设置服务（方案 §8.1）：~/.pi-wood/settings.json
 * 与 Pi 配置完全分离；渲染层经 settings:get/set IPC 读写，主进程深合并持久化。
 */
export interface PiWoodSettings {
  window: { layout: [number, number, number]; leftCollapsed: boolean; rightCollapsed: boolean };
  theme: { fallback: "light" | "dark" | "system"; pi?: string };
  editor: { fontSize: number; tabSize: number };
  recentProjects: string[];
  model: { provider: string; id: string };
  approval: {
    mode: "auto" | "highRisk" | "allAsk" | "denyAll";
    rules: Array<{ pattern: string; action: "allow" | "ask" | "deny" }>;
  };
  /** T7.2：按会话 id 记录「自动接受审批」开关；缺省（无 key）视为未开启（fail closed）。 */
  autoAcceptSessions: Record<string, boolean>;
  workbench: { layout: unknown | null };
  /** T5.2：插件启用状态（缺省视为启用；显式 false 才禁用） */
  pluginsEnabled: Record<string, boolean>;
}

export function defaultSettings(): PiWoodSettings {
  return {
    window: { layout: [22, 48, 30], leftCollapsed: false, rightCollapsed: false },
    theme: { fallback: "dark" },
    editor: { fontSize: 14, tabSize: 2 },
    recentProjects: [],
    model: { provider: "deepseek", id: "deepseek-v4-flash" },
    approval: { mode: "highRisk", rules: [] },
    autoAcceptSessions: {},
    workbench: { layout: null },
    pluginsEnabled: {},
  };
}

function settingsPath(): string {
  return join(APP_DATA_DIR, "settings.json");
}

export function loadSettings(): PiWoodSettings {
  const p = settingsPath();
  if (!existsSync(p)) return defaultSettings();
  try {
    return deepMerge(defaultSettings(), JSON.parse(readFileSync(p, "utf-8")));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(next: PiWoodSettings): void {
  const p = settingsPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(next, null, 2));
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return (patch as T) ?? base;
  }
  const out = { ...(base as object) } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = v !== null && typeof v === "object" && !Array.isArray(v) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

let cached: PiWoodSettings | null = null;
function ensureLoaded(): PiWoodSettings {
  cached ??= loadSettings();
  return cached;
}

/** 读取当前内存态设置（渲染层 settings:get 与主进程子系统共用同一份，避免闭包漂移）。 */
export function getSettings(): PiWoodSettings {
  return ensureLoaded();
}

/** 深合并补丁并落盘，返回最新全量。主进程（如插件启用态）与渲染层 settings:set 都走这里。 */
export function updateSettings(patch: unknown): PiWoodSettings {
  cached = deepMerge(ensureLoaded(), patch);
  saveSettings(cached);
  return cached;
}

export function initSettingsIpc(): PiWoodSettings {
  const initial = ensureLoaded();
  ipcMain.handle("settings:get", () => ensureLoaded());
  ipcMain.handle("settings:set", (_e, patch: unknown) => updateSettings(patch));
  return initial;
}
