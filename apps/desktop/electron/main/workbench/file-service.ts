import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { ipcMain } from "electron";
import { z } from "zod";
import ignore from "ignore";
import { FS_IMAGE_CHANNEL, isImagePath } from "@pi-wood/ipc-schema";
import { readImagePreview } from "./image-thumb.ts";

/**
 * 文件域 IPC（T2.1，方案 §3.2 fs:*）。
 * - tree：懒加载单层目录（万级文件项目不卡的关键）
 * - gitignore 感知：根 .gitignore + 内建忽略（node_modules/.git/dist/out）
 * - read/write：文本读写（大小上限 + 二进制检测）
 * - search：文件名子串搜索（有界遍历）
 * - image（T8.3 后续）：图片原图 dataURL，右栏预览用（read 会以「二进制不支持预览」拒掉图片）
 */
export interface FileEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", ".pi-wood", ".pi"]);
const MAX_READ_BYTES = 2 * 1024 * 1024;
const SEARCH_MAX_FILES = 20000;
const SEARCH_MAX_RESULTS = 50;

const TreeArgSchema = z.object({ dir: z.string().optional() });
const ReadArgSchema = z.object({ path: z.string().min(1) });
const WriteArgSchema = z.object({ path: z.string().min(1), content: z.string() });
const SearchArgSchema = z.object({ query: z.string().min(1) });
const ImageArgSchema = z.object({ path: z.string().min(1) });

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

  // 图片原图预览：fs:read 会把任何图片当二进制拒掉（「二进制文件不支持预览」），
  // 故单开一条通道。绝对路径（附件 / 粘贴暂存目录，都在项目根之外）直接读——与 fs:thumb
  // 同一信任模型（见 image-thumb.ts 头注：渲染进程无文件系统权限，范围由调用方路径决定）；
  // 相对路径按项目根解析并做越界守卫，与 fs:read 口径一致。
  ipcMain.handle(FS_IMAGE_CHANNEL, (_e, raw: unknown) => {
    const { path } = ImageArgSchema.parse(raw);
    const full = isAbsolute(path) ? path : join(getProjectDir(), path);
    if (!isAbsolute(path) && !full.startsWith(getProjectDir())) throw new Error("路径越界");
    // 渲染层判定「是不是图片」用的是同一份清单，走到这里还判非图片说明接线错了——
    // 响亮失败，不要静默返回 undefined 让右栏白屏（先例：`sessionsDelete?.()` 把「没接线」伪装成「已成功」）。
    if (!isImagePath(path)) throw new Error(`不是可预览的图片格式：${path}`);
    return readImagePreview(full);
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
