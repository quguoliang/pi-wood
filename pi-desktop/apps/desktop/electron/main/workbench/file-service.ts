import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ipcMain } from "electron";
import { z } from "zod";
import ignore from "ignore";

/**
 * 文件域 IPC（T2.1，方案 §3.2 fs:*）。
 * - tree：懒加载单层目录（万级文件项目不卡的关键）
 * - gitignore 感知：根 .gitignore + 内建忽略（node_modules/.git/dist/out）
 * - read/write：文本读写（大小上限 + 二进制检测）
 * - search：文件名子串搜索（有界遍历）
 */
export interface FileEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", ".pi-desktop", ".pi"]);
const MAX_READ_BYTES = 2 * 1024 * 1024;
const SEARCH_MAX_FILES = 20000;
const SEARCH_MAX_RESULTS = 50;

const TreeArgSchema = z.object({ dir: z.string().optional() });
const ReadArgSchema = z.object({ path: z.string().min(1) });
const WriteArgSchema = z.object({ path: z.string().min(1), content: z.string() });
const SearchArgSchema = z.object({ query: z.string().min(1) });

function loadIgnore(projectDir: string): ReturnType<typeof ignore> {
  const ig = ignore();
  for (const d of SKIP_DIRS) ig.add(d);
  const gitignore = join(projectDir, ".gitignore");
  if (existsSync(gitignore)) {
    try {
      ig.add(readFileSync(gitignore, "utf-8"));
    } catch {
      /* 读不到就只用内建忽略 */
    }
  }
  return ig;
}

export function initFileIpc(getProjectDir: () => string): void {
  ipcMain.handle("fs:tree", (_e, raw: unknown): FileEntry[] => {
    const { dir } = TreeArgSchema.parse(raw ?? {});
    const projectDir = getProjectDir();
    const target = dir ? join(projectDir, dir) : projectDir;
    if (!target.startsWith(projectDir)) throw new Error("路径越界");
    const ig = loadIgnore(projectDir);
    const out: FileEntry[] = [];
    for (const name of readdirSync(target)) {
      if (target === projectDir && ig.ignores(name)) continue;
      const full = join(target, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      out.push({
        name,
        path: relative(projectDir, full).split("\\").join("/"),
        type: st.isDirectory() ? "dir" : "file",
        size: st.size,
      });
    }
    return out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  });

  ipcMain.handle("fs:read", (_e, raw: unknown) => {
    const { path } = ReadArgSchema.parse(raw);
    const full = join(getProjectDir(), path);
    if (!full.startsWith(getProjectDir())) throw new Error("路径越界");
    const st = statSync(full);
    if (st.size > MAX_READ_BYTES) throw new Error(`文件过大（${Math.round(st.size / 1024)}KB > 2MB）`);
    const buf = readFileSync(full);
    if (buf.subarray(0, 4096).includes(0)) throw new Error("二进制文件不支持预览");
    return { content: buf.toString("utf-8"), truncated: false };
  });

  ipcMain.handle("fs:write", (_e, raw: unknown) => {
    const { path, content } = WriteArgSchema.parse(raw);
    const full = join(getProjectDir(), path);
    if (!full.startsWith(getProjectDir())) throw new Error("路径越界");
    writeFileSync(full, content, "utf-8");
    return true;
  });

  ipcMain.handle("fs:search", (_e, raw: unknown): Array<{ path: string; type: "dir" | "file" }> => {
    const { query } = SearchArgSchema.parse(raw);
    const projectDir = getProjectDir();
    const ig = loadIgnore(projectDir);
    const q = query.toLowerCase();
    const results: Array<{ path: string; type: "dir" | "file" }> = [];
    const walk = (dir: string, depth: number, visited: number): number => {
      if (depth > 12 || visited > SEARCH_MAX_FILES || results.length >= SEARCH_MAX_RESULTS) return visited;
      let names: string[] = [];
      try {
        names = readdirSync(dir);
      } catch {
        return visited;
      }
      for (const name of names) {
        if (visited > SEARCH_MAX_FILES) return visited;
        if (dir === projectDir && ig.ignores(name)) continue;
        visited++;
        const full = join(dir, name);
        let isDir = false;
        try {
          isDir = statSync(full).isDirectory();
        } catch {
          continue;
        }
        const rel = relative(projectDir, full).split("\\").join("/");
        if (!isDir) {
          if (rel.toLowerCase().includes(q) || name.toLowerCase().includes(q)) {
            results.push({ path: rel, type: "file" });
            if (results.length >= SEARCH_MAX_RESULTS) return visited;
          }
        } else if (!SKIP_DIRS.has(name)) {
          if (name.toLowerCase().includes(q)) {
            results.push({ path: rel, type: "dir" });
          }
          visited = walk(full, depth + 1, visited);
        }
      }
      return visited;
    };
    walk(projectDir, 0, 0);
    return results;
  });
}
