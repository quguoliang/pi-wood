import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { ipcMain } from "electron";
import { fileWriteQueue } from "./workbench/write-queue.ts";

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
  /**
   * T7.5/T7.9：辅助类小任务（目标进度审计、会话 recap/追问）专用模型。缺省=沿用上面 model。
   * 用于让主对话用强模型、审计/辅助用便宜模型。选模型见 provider/model-pick.ts。
   */
  smallModel?: { provider: string; id: string } | null;
  approval: {
    mode: "auto" | "highRisk" | "allAsk" | "denyAll";
    rules: Array<{ pattern: string; action: "allow" | "ask" | "deny" }>;
  };
  /** T7.2：按会话 id 记录「自动接受审批」开关；缺省（无 key）视为未开启（fail closed）。 */
  autoAcceptSessions: Record<string, boolean>;
  /**
   * T7.12：per-provider 月度配额（token/cost）。超限在用量页/环境面板告警（默认只警告不阻断）。
   * providerId → {monthlyTokenBudget?, monthlyCostBudget?}。
   */
  quota: Record<string, { monthlyTokenBudget?: number; monthlyCostBudget?: number }>;
  workbench: { layout: unknown | null };
  /** T5.2：插件启用状态（缺省视为启用；显式 false 才禁用） */
  pluginsEnabled: Record<string, boolean>;
  /**
   * T6.7：子代理 per-tool 审批权限覆盖（方案 §7.7）。按 agent profile 名索引，
   * 值是该 agent 内「工具名 → allow|ask|deny」。子代理 child 审批门据此覆盖全局策略；
   * 未列出的 agent/工具回退父全局审批策略（继承）。刻意存于 pi-wood 自有 settings 而非 agent
   * frontmatter——vendored profile 校验会把未知 frontmatter 键判为无效并跳过整份 profile。
   */
  subagentPermissions: Record<string, Record<string, "allow" | "ask" | "deny">>;
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
    quota: {},
    workbench: { layout: null },
    pluginsEnabled: {},
    subagentPermissions: {},
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

/**
 * 整体替换某一顶层配置段（非深合并）并落盘 + 更新共享 cached。
 * 用于「需要删除键」的映射（如 T6.7 subagentPermissions 的清档/继承），
 * 保证后续其它标签页的 settings:set 深合并不会拿陈旧段回写覆盖。
 */
export function replaceSection<K extends keyof PiWoodSettings>(
  key: K,
  value: PiWoodSettings[K],
): PiWoodSettings {
  cached = { ...ensureLoaded(), [key]: value };
  saveSettings(cached);
  return cached;
}

export function initSettingsIpc(): PiWoodSettings {
  const initial = ensureLoaded();
  ipcMain.handle("settings:get", () => ensureLoaded());
  // T8.7 写并发保护：settings:set 走 per-file 串行临界区（多对话/多来源并发 patch 不丢更新）
  ipcMain.handle("settings:set", (_e, patch: unknown) => fileWriteQueue.withLock("settings.json", () => updateSettings(patch)));
  return initial;
}
