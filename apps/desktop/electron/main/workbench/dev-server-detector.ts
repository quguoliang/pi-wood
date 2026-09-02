import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { ipcMain } from "electron";
import { ENGINE_CHANNELS, type DevServerInfo } from "@pi-wood/ipc-schema";
import {
  type RawListen,
  parseNetstat,
  parseLsofFpcn,
  parseProcNetTcp,
  filterDevServers,
} from "./dev-server-parse";

const execFileAsync = promisify(execFile);

/** Windows tasklist → pid 到进程映像名映射（命令名可选，失败降级）。 */
async function readPidNames(): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const { stdout } = await execFileAsync("tasklist", ["/fo", "csv", "/nh"], { windowsHide: true });
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(/^"([^"]+)","(\d+)"/);
      if (m) map.set(Number(m[2]), m[1]);
    }
  } catch {
    /* 忽略：命令名可选 */
  }
  return map;
}

/** 采集当前平台所有 loopback 监听端口。 */
export async function detectDevServers(platform: NodeJS.Platform = process.platform): Promise<DevServerInfo[]> {
  let raw: RawListen[] = [];
  if (platform === "win32") {
    const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "TCP"], { windowsHide: true });
    const names = await readPidNames();
    raw = parseNetstat(stdout).map((r) => (r.pid != null ? { ...r, command: names.get(r.pid) ?? r.command } : r));
  } else if (platform === "darwin") {
    const { stdout } = await execFileAsync("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n", "-F", "pcn"]);
    raw = parseLsofFpcn(stdout);
  } else {
    const entries: RawListen[] = [];
    for (const f of ["tcp", "tcp6"]) {
      try {
        entries.push(...parseProcNetTcp(await readFile(`/proc/net/${f}`, "utf8")));
      } catch {
        /* 文件可能不存在 */
      }
    }
    raw = entries;
  }
  return filterDevServers(raw);
}

/** 5s 缓存，避免浏览器面板频繁轮询打爆子进程。 */
const CACHE_TTL_MS = 5000;
let cache: { at: number; data: DevServerInfo[] } | undefined;

export async function listDevServersCached(): Promise<DevServerInfo[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.data;
  try {
    const data = await detectDevServers();
    cache = { at: now, data };
    return data;
  } catch {
    return cache?.data ?? [];
  }
}

export function initDevServerIpc(): void {
  ipcMain.handle(ENGINE_CHANNELS.listDevServers, () => listDevServersCached());
}
