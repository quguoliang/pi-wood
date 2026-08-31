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
} from "@pidesk/ipc-schema";
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

  return pm;
}
