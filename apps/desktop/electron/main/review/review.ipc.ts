import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ipcMain } from "electron";
import { REVIEW_CHANNELS, type ReviewResult, type WorkingDiff, type WorkingDiffFile } from "@pi-wood/ipc-schema";
import { getActiveWorkspaceDir } from "../engine/engine-manager.ts";
import { runReview } from "./review-service.ts";
import { hasChanges } from "./parse-findings.ts";

const exec = promisify(execFile);

/** 活动项目相对 HEAD 的 diff（tracked 暂存+未暂存）。git 不可用/无仓库 → 抛错由调用方兜。 */
async function gitDiffHead(cwd: string): Promise<string> {
  const { stdout } = await exec("git", ["diff", "HEAD"], { cwd, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  return stdout;
}

/** `git status --porcelain` → Map<路径, XY>（重命名按新路径键；含未跟踪 "??"）。 */
async function porcelainStatus(cwd: string): Promise<Map<string, string>> {
  const { stdout } = await exec("git", ["status", "--porcelain"], { cwd, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  const map = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const xy = line.slice(0, 2);
    let p = line.slice(3);
    if (p.includes(" -> ")) p = p.split(" -> ").pop() ?? p;
    map.set(p.trim(), xy);
  }
  return map;
}

/** `git diff --numstat HEAD` → Map<路径, {added,deleted,binary}>（二进制行的 added/deleted 为 "-"）。 */
async function numstatHead(cwd: string): Promise<Map<string, { added: number; deleted: number; binary: boolean }>> {
  const { stdout } = await exec("git", ["diff", "--numstat", "HEAD"], { cwd, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  const map = new Map<string, { added: number; deleted: number; binary: boolean }>();
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const a = parts[0] ?? "0";
    const d = parts[1] ?? "0";
    let p = parts.slice(2).join("\t");
    if (p.includes(" => ")) p = p.split(" => ").pop() ?? p;
    map.set(p.trim(), { added: a === "-" ? 0 : Number(a) || 0, deleted: d === "-" ? 0 : Number(d) || 0, binary: a === "-" || d === "-" });
  }
  return map;
}

async function readWorkingBuffer(dir: string, path: string): Promise<Buffer | null> {
  try {
    return await readFile(join(dir, path));
  } catch {
    return null; // 已删除 / 不可读
  }
}

async function showHeadBuffer(dir: string, path: string): Promise<Buffer | null> {
  try {
    const { stdout } = (await exec("git", ["show", `HEAD:${path}`], {
      cwd: dir,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      encoding: "buffer",
    })) as { stdout: Buffer };
    return stdout;
  } catch {
    return null; // HEAD 里没有该文件（新增 / 未跟踪）
  }
}

const hasNull = (buf: Buffer | null): boolean => !!buf && buf.includes(0);
const CONTENT_CAP = 512 * 1024; // 单侧超过则不内联（引导用户点「打开」）

/**
 * T7.7 代码审查 IPC：对活动项目跑 `git diff HEAD` → 隔离小模型审查 → 结构化发现列表。
 * 无变更 → empty:true（前端空态）；非 git 仓库/读 diff 失败 → error 友好文案。
 * 另提供 workingDiff：逐文件 before/after 全文，供渲染层用 CodeMirror 合并视图展示原始 diff。
 */
export function initReviewIpc(): void {
  ipcMain.handle(REVIEW_CHANNELS.run, async (): Promise<ReviewResult> => {
    const dir = getActiveWorkspaceDir(); // T8.7：审查 diff 按当前对话的树，不读主树
    if (!dir) return { findings: [], diffChars: 0, empty: true, error: "先在左栏选择一个项目" };
    let diff = "";
    try {
      diff = await gitDiffHead(dir);
    } catch (e) {
      return { findings: [], diffChars: 0, empty: true, error: `读取 git diff 失败：${e instanceof Error ? e.message : String(e)}` };
    }
    if (!hasChanges(diff)) return { findings: [], diffChars: diff.length, empty: true };
    const { findings, error } = await runReview(diff);
    return { findings, diffChars: diff.length, empty: false, error };
  });

  // 「查看变更」：活动工作区相对 HEAD 的逐文件 before/after（不经模型），渲染层用 unifiedMergeView 展示
  ipcMain.handle(REVIEW_CHANNELS.workingDiff, async (): Promise<WorkingDiff> => {
    const dir = getActiveWorkspaceDir();
    if (!dir) return { ok: false, error: "先在左栏选择一个项目", files: [] };
    try {
      const branchOut = await exec("git", ["branch", "--show-current"], { cwd: dir, windowsHide: true });
      const branch = branchOut.stdout.trim() || undefined;
      const status = await porcelainStatus(dir);
      const num = await numstatHead(dir);
      const files: WorkingDiffFile[] = [];
      for (const [path, xy] of status) {
        const n = num.get(path);
        const workBuf = await readWorkingBuffer(dir, path);
        const headBuf = await showHeadBuffer(dir, path);
        const binary = (n?.binary ?? false) || hasNull(workBuf) || hasNull(headBuf);
        let before = "";
        let after = "";
        let truncated = false;
        if (!binary) {
          before = headBuf ? headBuf.toString("utf8") : "";
          after = workBuf ? workBuf.toString("utf8") : "";
          if (before.length > CONTENT_CAP || after.length > CONTENT_CAP) {
            truncated = true;
            before = "";
            after = "";
          }
        }
        const added = xy === "??" ? (after ? after.split("\n").length : 0) : n?.added ?? 0;
        const deleted = xy === "??" ? 0 : n?.deleted ?? 0;
        files.push({ path, status: xy, added, deleted, binary, truncated, before, after });
      }
      return { ok: true, branch, files };
    } catch (e) {
      return { ok: false, error: `读取工作区变更失败：${e instanceof Error ? e.message : String(e)}`, files: [] };
    }
  });
}
