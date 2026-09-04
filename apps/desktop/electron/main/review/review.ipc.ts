import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ipcMain } from "electron";
import { REVIEW_CHANNELS, type ReviewResult } from "@pi-wood/ipc-schema";
import { getActiveWorkspaceDir } from "../engine/engine-manager.ts";
import { runReview } from "./review-service.ts";
import { hasChanges } from "./parse-findings.ts";

const exec = promisify(execFile);

/** 活动项目相对 HEAD 的 diff（tracked 暂存+未暂存）。git 不可用/无仓库 → 抛错由调用方兜。 */
async function gitDiffHead(cwd: string): Promise<string> {
  const { stdout } = await exec("git", ["diff", "HEAD"], { cwd, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  return stdout;
}

/**
 * T7.7 代码审查 IPC：对活动项目跑 `git diff HEAD` → 隔离小模型审查 → 结构化发现列表。
 * 无变更 → empty:true（前端空态）；非 git 仓库/读 diff 失败 → error 友好文案。
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
}
