import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { ipcMain } from "electron";

// 与 project-manager.ts 的 DEFAULT_APP_DATA_DIR 保持一致（~/.pi-wood）
const APP_DATA_DIR = join(process.env["USERPROFILE"] ?? process.env["HOME"] ?? ".", ".pi-wood");

/**
 * 应用设置服务（方案 §8.1）：~/.pi-wood/settings.json
 * 与 Pi 配置完全分离；渲染层经 settings:get/set IPC 读写，主进程深合并持久化。
 */
export interface pi-woodSettings {
  window: { layout: [number, number, number]; rightCollapsed: boolean };
  theme: { fallback: "light" | "dark" | "system" };
  editor: { fontSize: number; tabSize: number };
  recentProjects: string[];
  model: { provider: string; id: string };
  approval: {
    mode: "auto" | "highRisk" | "allAsk" | "denyAll";
    rules: Array<{ pattern: string; action: "allow" | "ask" | "deny" }>;
  };
}

export function defaultSettings(): pi-woodSettings {
  return {
    window: { layout: [22, 48, 30], rightCollapsed: false },
    theme: { fallback: "dark" },
    editor: { fontSize: 14, tabSize: 2 },
    recentProjects: [],
    model: { provider: "", id: "" },
    approval: { mode: "highRisk", rules: [] },
  };
}

function settingsPath(): string {
  return join(APP_DATA_DIR, "settings.json");
}

export function loadSettings(): pi-woodSettings {
  const p = settingsPath();
  if (!existsSync(p)) return defaultSettings();
  try {
    return { ...defaultSettings(), ...(JSON.parse(readFileSync(p, "utf-8")) as Partial<pi-woodSettings>) };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(next: pi-woodSettings): void {
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

export function initSettingsIpc(): pi-woodSettings {
  let current = loadSettings();
  ipcMain.handle("settings:get", () => current);
  ipcMain.handle("settings:set", (_e, patch: unknown) => {
    current = deepMerge(current, patch);
    saveSettings(current);
    return current;
  });
  return current;
}
