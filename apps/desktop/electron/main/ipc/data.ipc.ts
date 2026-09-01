import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { ipcMain } from "electron";
import { z } from "zod";
import {
  PROJECT_CHANNELS,
  SESSION_CHANNELS,
  IdArgSchema,
  PathArgSchema,
  FileArgSchema,
} from "@pi-wood/ipc-schema";
import { ProjectManager, DEFAULT_APP_DATA_DIR } from "../project/project-manager.ts";
import { listSessions, openSessionTree, loadSessionMessages } from "../engine/session-service.ts";

/** T3.4：包管理（实验性，经全局 pi CLI；超时 120s） */
function piExec(args: string[], timeoutMs = 120000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("pi", args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || stdout || err)));
      else resolve(String(stdout));
    });
  });
}

/** 插件市场条目（npm registry 上以 npm 包发布的 Pi 扩展）。 */
export interface MarketItem {
  name: string;
  version: string;
  description: string;
  author: string;
  updated: string;
  source: string; // 规范安装源：npm:<name>
}

/** pi 扩展启发式：名称/描述命中 pi 生态关键词。 */
const PI_HINT = /\bpi\b|pi[-_ ]?(extension|agent|coding|plugin|tool)|for pi\b|pi coding|pi agent|pi-extension/i;

function toMarketItem(raw: unknown): MarketItem | null {
  const pkg = (raw as { package?: Record<string, unknown> })?.package;
  if (!pkg || typeof pkg.name !== "string") return null;
  const maintainers = pkg.maintainers as Array<{ username?: string }> | undefined;
  const publisher = pkg.publisher as { username?: string } | undefined;
  return {
    name: pkg.name,
    version: typeof pkg.version === "string" ? pkg.version : "",
    description: typeof pkg.description === "string" ? pkg.description.trim() : "",
    author: publisher?.username ?? maintainers?.[0]?.username ?? "",
    updated: typeof pkg.date === "string" ? pkg.date : "",
    source: `npm:${pkg.name}`,
  };
}

/** 经 npm registry 公开检索 API 查 Pi 扩展；query 为空时给默认「发现」词。 */
async function npmSearchPiExtensions(query: string, size = 30): Promise<MarketItem[]> {
  const trimmed = query.trim();
  const text = trimmed ? `${trimmed} pi` : "pi extension";
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=${size}`;
  const res = await fetch(url, { headers: { "user-agent": "pi-wood-marketplace" }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`npm 检索失败：HTTP ${res.status}`);
  const json = (await res.json()) as { objects?: unknown[] };
  const seen = new Set<string>();
  const items: MarketItem[] = [];
  for (const obj of json.objects ?? []) {
    const item = toMarketItem(obj);
    if (!item || seen.has(item.name)) continue;
    if (!PI_HINT.test(`${item.name} ${item.description}`)) continue;
    seen.add(item.name);
    items.push(item);
  }
  return items;
}

export function initDataIpc(agentDir: string, getProjectDir: () => string | undefined): ProjectManager {
  const pm = new ProjectManager(DEFAULT_APP_DATA_DIR, agentDir);

  ipcMain.handle(PROJECT_CHANNELS.list, () => pm.list());
  ipcMain.handle(PROJECT_CHANNELS.add, (_e, raw: unknown) => {
    const { path } = PathArgSchema.parse(raw);
    return pm.add(path);
  });
  ipcMain.handle(PROJECT_CHANNELS.remove, (_e, raw: unknown) => {
    const { id } = IdArgSchema.parse(raw);
    return pm.remove(id);
  });
  ipcMain.handle(PROJECT_CHANNELS.trustStatus, (_e, raw: unknown) => {
    const { path } = PathArgSchema.parse(raw);
    return pm.trustStatus(path);
  });

  ipcMain.handle(SESSION_CHANNELS.list, (_e, raw: unknown) => {
    const { path } = PathArgSchema.parse(raw);
    return listSessions(path);
  });
  ipcMain.handle(SESSION_CHANNELS.tree, (_e, raw: unknown) => {
    const { file } = FileArgSchema.parse(raw);
    return openSessionTree(file);
  });
  ipcMain.handle(SESSION_CHANNELS.messages, (_e, raw: unknown) => {
    const { file } = FileArgSchema.parse(raw);
    return loadSessionMessages(file);
  });

  // ---- T3.1 扩展列表（全局 agentDir/extensions + 项目 .pi/extensions）----
  const scanExtensions = (dir: string, source: string): Array<{ source: string; name: string; path: string }> => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.name.endsWith(".ts") || d.name.endsWith(".js") || d.isDirectory())
      .map((d) => ({ source, name: d.name.replace(/\.(ts|js)$/, ""), path: join(dir, d.name) }));
  };
  ipcMain.handle("extensions:list", () => {
    const projectDir = getProjectDir();
    return [
      ...scanExtensions(join(agentDir, "extensions"), "global"),
      ...(projectDir ? scanExtensions(join(projectDir, ".pi", "extensions"), "project") : []),
    ];
  });

  const scanResourceDir = (dir: string, source: string, kind: "skill" | "prompt") => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || /\.(md|txt)$/.test(entry.name))
      .map((entry) => ({ kind, source, name: entry.name.replace(/\.(md|txt)$/, ""), path: join(dir, entry.name) }));
  };
  ipcMain.handle("resources:list", () => {
    const projectDir = getProjectDir();
    return [
      ...scanResourceDir(join(agentDir, "skills"), "global", "skill"),
      ...scanResourceDir(join(agentDir, "prompts"), "global", "prompt"),
      ...(projectDir ? scanResourceDir(join(projectDir, ".pi", "skills"), "project", "skill") : []),
      ...(projectDir ? scanResourceDir(join(projectDir, ".agents", "skills"), "agents", "skill") : []),
      ...(projectDir ? scanResourceDir(join(projectDir, ".pi", "prompts"), "project", "prompt") : []),
    ];
  });

  // ---- T3.4 包管理（实验：pi CLI 安装 / settings.packages 列表）----
  ipcMain.handle("packages:list", () => {
    const settingsPath = join(agentDir, "settings.json");
    if (!existsSync(settingsPath)) return { packages: [] };
    try {
      const s = JSON.parse(readFileSync(settingsPath, "utf-8")) as { packages?: string[] };
      return { packages: s.packages ?? [] };
    } catch {
      return { packages: [] };
    }
  });
  ipcMain.handle("packages:install", async (_e, raw: unknown) => {
    const { spec } = z.object({ spec: z.string().min(1) }).parse(raw);
    const output = await piExec(["install", spec]);
    return { ok: true, output: output.slice(0, 2000) };
  });
  ipcMain.handle("packages:uninstall", async (_e, raw: unknown) => {
    const { spec } = z.object({ spec: z.string().min(1) }).parse(raw);
    const output = await piExec(["remove", spec]);
    return { ok: true, output: output.slice(0, 2000) };
  });
  ipcMain.handle("packages:update", async (_e, raw: unknown) => {
    const { spec } = z.object({ spec: z.string().optional() }).parse(raw ?? {});
    const args = spec ? ["update", spec] : ["update", "--extensions"];
    const output = await piExec(args);
    return { ok: true, output: output.slice(0, 2000) };
  });
  // ---- 插件市场：npm registry 检索 Pi 扩展（真实市场数据源）----
  ipcMain.handle("packages:search", async (_e, raw: unknown) => {
    const { query } = z.object({ query: z.string().default("") }).parse(raw ?? {});
    try {
      return { ok: true, items: await npmSearchPiExtensions(query) };
    } catch (error) {
      const msg = String((error as Error)?.name ?? "") === "TimeoutError" || String((error as Error)?.message ?? "").includes("abort")
        ? "检索超时：网络不可达或被拦截"
        : String((error as Error)?.message ?? error);
      return { ok: false, items: [], error: msg };
    }
  });

  return pm;
}
