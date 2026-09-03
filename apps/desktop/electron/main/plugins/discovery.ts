import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  PIWOOD_MANIFEST_FILE,
  PLUGIN_PERMISSIONS,
  type LoadedPlugin,
  type PanelDefinition,
  type PiPackageManifest,
  type PluginPermission,
} from "@pi-wood/plugin-api";

/**
 * 插件发现（T5.2，方案 §6.4）。两个来源：
 * - bundled：应用内置示例目录（dev 下 <appPath>/plugins-examples）
 * - user：用户级 ~/.pi-wood/plugins/<dir>
 * 每个「目录」若含 piwood-plugin.json 且解析出合法 desktop.entry 才算一个插件。
 */

const VALID_PERMS = new Set<string>(PLUGIN_PERMISSIONS);

function userPluginsDir(): string {
  return join(homedir(), ".pi-wood", "plugins");
}

/** 返回 [source, 绝对目录] 的候选根。缺失目录自动跳过。 */
export function pluginRoots(appPath: string): Array<{ source: "bundled" | "user"; dir: string }> {
  const roots: Array<{ source: "bundled" | "user"; dir: string }> = [];
  const bundled = join(appPath, "plugins-examples");
  if (existsSync(bundled)) roots.push({ source: "bundled", dir: bundled });
  const user = userPluginsDir();
  if (existsSync(user)) roots.push({ source: "user", dir: user });
  return roots;
}

function sanitizePerms(raw: unknown): PluginPermission[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<PluginPermission>();
  for (const p of raw) {
    if (typeof p === "string" && VALID_PERMS.has(p)) out.add(p as PluginPermission);
  }
  return [...out];
}

function sanitizePanels(raw: unknown): PanelDefinition[] {
  if (!Array.isArray(raw)) return [];
  const out: PanelDefinition[] = [];
  for (const p of raw) {
    if (p && typeof p === "object" && typeof (p as PanelDefinition).id === "string" && typeof (p as PanelDefinition).title === "string") {
      out.push(p as PanelDefinition);
    }
  }
  return out;
}

/**
 * 读取一个插件目录。失败/非法（缺 name/version 或入口文件不存在）时返回 undefined 并记 reason。
 */
function loadPluginDir(dir: string, source: "bundled" | "user", enabledMap: Record<string, boolean> | undefined, problems: string[]): LoadedPlugin | undefined {
  const manifestPath = join(dir, PIWOOD_MANIFEST_FILE);
  if (!existsSync(manifestPath)) return undefined;
  let manifest: PiPackageManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as PiPackageManifest;
  } catch (e) {
    problems.push(`${dir}: manifest JSON 解析失败 ${String(e)}`);
    return undefined;
  }
  const desktop = manifest.pi?.desktop;
  if (!manifest.name || !manifest.version || !desktop?.entry) {
    problems.push(`${dir}: manifest 缺 name/version 或 pi.desktop.entry，跳过`);
    return undefined;
  }
  const entryPath = isAbsolute(desktop.entry) ? desktop.entry : resolve(dir, desktop.entry);
  if (!existsSync(entryPath) || !statSync(entryPath).isFile()) {
    problems.push(`${dir}: 入口 ${desktop.entry} 不存在，跳过`);
    return undefined;
  }
  return {
    id: manifest.name,
    displayName: manifest.displayName ?? manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    entryPath,
    dir,
    permissions: sanitizePerms(desktop.permissions),
    panels: sanitizePanels(desktop.panels),
    source,
    enabled: enabledMap ? enabledMap[manifest.name] !== false : true,
  };
}

/** 扫描所有来源，返回发现到的插件（含被禁用的）。problems 收集非法目录原因供 UI/日志。 */
export function discoverPlugins(appPath: string, enabledMap: Record<string, boolean> | undefined, problems: string[]): LoadedPlugin[] {
  const found: LoadedPlugin[] = [];
  const seen = new Set<string>();
  for (const { source, dir } of pluginRoots(appPath)) {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const sub = join(dir, name);
      try {
        if (!statSync(sub).isDirectory()) continue;
      } catch {
        continue;
      }
      const plugin = loadPluginDir(sub, source, enabledMap, problems);
      if (!plugin) continue;
      // user 覆盖 bundled（同 id 以 user 为准），保证用户可替换内置示例
      if (seen.has(plugin.id)) {
        const idx = found.findIndex((p) => p.id === plugin.id);
        if (idx >= 0 && source === "user") found[idx] = plugin;
        continue;
      }
      seen.add(plugin.id);
      found.push(plugin);
    }
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}
