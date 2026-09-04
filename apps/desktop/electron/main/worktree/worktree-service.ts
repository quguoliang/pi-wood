import { execFile } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  WORKTREE_DIRNAME,
  branchFor,
  isManagedWorktree,
  isPathLengthOk,
  worktreePathFor,
} from "./worktree-naming.ts";

/**
 * worktree 服务（T8.6）——**electron-free**（execFile + git），可脱离 Electron 用真 git 仓库单测。
 *
 * 判据全部来自 T8.0 P2 实测：
 * - `git worktree add` 快（真实仓库 151~180ms、不复制 node_modules、工作树 3.3MB）；
 * - 回流固定 `git apply --3way --ignore-whitespace`（git 2.54 对空行上下文补丁会非零退出但内容已落盘，
 *   --ignore-whitespace 实测归零）且**以内容/diff 复核，不只看退出码**；
 * - 冲突**不自动合并**：失败即报 conflict，保留 worktree 供手工处理。
 */

const exec = promisify(execFile);

export interface GitResult {
  ok: boolean;
  out: string;
  err: string;
}

async function git(args: string[], cwd: string): Promise<GitResult> {
  try {
    const { stdout } = await exec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return { ok: true, out: stdout, err: "" };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, out: e.stdout ?? "", err: e.stderr ?? e.message ?? String(err) };
  }
}

// ---------- 降级探测（非 git / detached / submodule；显式降级，不悄悄共享主树） ----------

export type FeasibilityCode = "ok" | "not-git" | "detached" | "submodule" | "path-too-long";

export interface WorktreeFeasibility {
  code: FeasibilityCode;
  /** 非 ok 时给用户的显式说明（不可静默降级） */
  reason?: string;
}

export async function detectWorktreeFeasibility(projectDir: string): Promise<WorktreeFeasibility> {
  const inside = await git(["rev-parse", "--is-inside-work-tree"], projectDir);
  if (!inside.ok || inside.out.trim() !== "true") {
    return {
      code: "not-git",
      reason: "该目录不是 git 仓库，无法为对话隔离工作树。该对话将共享主工作树，存在互相覆盖风险。",
    };
  }
  const detached = await git(["symbolic-ref", "-q", "HEAD"], projectDir);
  if (!detached.ok) {
    return {
      code: "detached",
      reason: "仓库处于 detached HEAD 状态，无法创建分支工作树。该对话将共享主工作树，存在互相覆盖风险。",
    };
  }
  if (existsSync(join(projectDir, ".gitmodules"))) {
    return {
      code: "submodule",
      reason: "仓库含子模块：工作树内的子模块目录默认为空（需 git submodule update --init），子模块改动不会回流主工作树。",
    };
  }
  const p = worktreePathFor(projectDir, "x".repeat(24));
  if (!isPathLengthOk(p)) {
    return { code: "path-too-long", reason: "项目路径过长，工作树路径将超出系统限制。请把项目移到更短的根路径。" };
  }
  return { code: "ok" };
}

// ---------- ensure / remove ----------

export interface EnsureResult {
  status: "created" | "existing" | "degraded-shared";
  /** 引擎实际应使用的 cwd：worktree 路径，或降级时的主项目目录 */
  cwd: string;
  branch?: string;
  /** 建树时的主树 HEAD（回流 diff 基线；existing/降级时缺省 → 回流退回 merge-base） */
  baseRef?: string;
  reason?: string;
}

/**
 * 惰性建树（T8.0 实测 151~180ms，调用方无需后台化也不会卡 UI）：
 * `git worktree add -b piwood/<id> <path> HEAD`。已存在则复用（崩溃/重启后同一对话重建命中）。
 * 不可建（非 git 等）→ 显式降级共享主树并带原因，调用方必须把它呈现给用户。
 * `linkNodeModules`：主树有 node_modules 而树上没有 → 打一个目录软链/联结（策略=「共享依赖」，不复制）。
 */
export async function ensureWorktree(
  projectDir: string,
  conversationId: string,
  opts: { linkNodeModules?: boolean } = {},
): Promise<EnsureResult> {
  const path = worktreePathFor(projectDir, conversationId);
  const branch = branchFor(conversationId);
  if (existsSync(join(path, ".git"))) {
    return { status: "existing", cwd: path, branch };
  }
  const feasibility = await detectWorktreeFeasibility(projectDir);
  if (feasibility.code !== "ok") {
    return { status: "degraded-shared", cwd: projectDir, reason: feasibility.reason };
  }
  mkdirSync(join(projectDir, WORKTREE_DIRNAME), { recursive: true });
  const add = await git(["worktree", "add", "-b", branch, path, "HEAD"], projectDir);
  if (!add.ok) {
    // 分支已存在（上次未清理）→ 复用既有分支再建树，仍失败才降级
    const retry = await git(["worktree", "add", path, branch], projectDir);
    if (!retry.ok) {
      return {
        status: "degraded-shared",
        cwd: projectDir,
        reason: `工作树创建失败，该对话将共享主工作树：${retry.err.split("\n")[0]?.slice(0, 160)}`,
      };
    }
  }
  if (opts.linkNodeModules !== false) linkNodeModules(projectDir, path);
  const head = await git(["rev-parse", "HEAD"], projectDir);
  return { status: "created", cwd: path, branch, baseRef: head.ok ? head.out.trim() : undefined };
}

/** node_modules 策略（T8.0 实测定案）：**不复制**，主树有则软链进树（junction/dir），失败静默（树内仍可手工安装） */
function linkNodeModules(projectDir: string, wtPath: string): void {
  const src = join(projectDir, "node_modules");
  const dst = join(wtPath, "node_modules");
  if (!existsSync(src) || existsSync(dst)) return;
  try {
    symlinkSync(src, dst, "junction");
  } catch {
    /* 软链失败不致命：树内 bash 可手工安装；不静默复制依赖 */
  }
}

export interface WorktreeCleanState {
  dirty: boolean;
  untracked: string[];
}

/** 树内是否有未提交改动（含未跟踪文件——回流时它们会被显式列出，删除时视为脏） */
export async function worktreeCleanState(wtPath: string): Promise<WorktreeCleanState> {
  const tracked = await git(["status", "--porcelain", "--untracked-files=no"], wtPath);
  const untracked = await git(["ls-files", "--others", "--exclude-standard"], wtPath);
  return {
    dirty: tracked.out.trim().length > 0 || untracked.out.trim().length > 0,
    untracked: untracked.out.split("\n").filter((l) => l.trim()),
  };
}

export interface RemoveResult {
  ok: boolean;
  reason?: string;
}

/** 回收：脏树拒绝（先回流或丢弃，用 force 显式丢弃）；成功 = remove + prune + 删分支 */
export async function removeWorktree(
  projectDir: string,
  conversationId: string,
  opts: { force?: boolean } = {},
): Promise<RemoveResult> {
  const path = worktreePathFor(projectDir, conversationId);
  const branch = branchFor(conversationId);
  if (!existsSync(join(path, ".git"))) {
    // 树已不在：仍收尾 prune + 删分支（幂等）
    await git(["worktree", "prune"], projectDir);
    await git(["branch", "-D", branch], projectDir);
    return { ok: true };
  }
  if (!opts.force) {
    const state = await worktreeCleanState(path);
    if (state.dirty) {
      return {
        ok: false,
        reason: `工作树有未提交改动（未跟踪 ${state.untracked.length} 项）。请先回流，或确认丢弃后强制删除。`,
      };
    }
  }
  const rm = await git(["worktree", "remove", "--force", path], projectDir);
  if (!rm.ok) return { ok: false, reason: rm.err.split("\n")[0]?.slice(0, 160) };
  await git(["worktree", "prune"], projectDir);
  await git(["branch", "-D", branch], projectDir);
  return { ok: true };
}

// ---------- 回流（merge-back） ----------

export interface MergeBackResult {
  status: "applied" | "conflict" | "nothing-to-merge";
  /** 回流进主树的文件（内容/diff 复核用，不只看退出码） */
  appliedFiles: string[];
  /** 冲突文件（--3way 落了 UU 标记；不自动合并，保留 worktree 供手工处理） */
  conflictedFiles: string[];
  /** 树内未跟踪文件：显式列出，不自动搬进主树 */
  untracked: string[];
  patch: string;
}

/**
 * 回流：取 `git -C <wt> diff <baseRef>`（baseRef=建树时的 HEAD，含已提交+未提交改动），
 * 在主树 `git apply --3way --ignore-whitespace`；**以内容复核**：apply 后比对主树
 * `--diff-filter=U` 判冲突、`name-only` 判落盘文件。
 */
export async function mergeBackWorktree(
  projectDir: string,
  conversationId: string,
  opts: { baseRef: string },
): Promise<MergeBackResult> {
  const path = worktreePathFor(projectDir, conversationId);
  const branch = branchFor(conversationId);
  const empty: MergeBackResult = { status: "nothing-to-merge", appliedFiles: [], conflictedFiles: [], untracked: [], patch: "" };
  if (!existsSync(join(path, ".git"))) return { ...empty, status: "conflict", conflictedFiles: [], untracked: [] };
  const state = await worktreeCleanState(path);
  const untracked = state.untracked;

  // diff 基线：建树时的 HEAD（baseRef）。baseRef 不可用则退回 merge-base(main…branch)。
  let base = opts.baseRef;
  const baseOk = base ? (await git(["cat-file", "-e", `${base}^{commit}`], projectDir)).ok : false;
  if (!baseOk) {
    const mb = await git(["merge-base", "HEAD", branch], projectDir);
    base = mb.ok ? mb.out.trim() : "";
  }
  const diff = base ? await git(["diff", base], path) : await git(["diff", "HEAD"], path);
  const patch = diff.out;
  if (!patch.trim()) {
    return { status: untracked.length > 0 ? "applied" : "nothing-to-merge", appliedFiles: [], conflictedFiles: [], untracked, patch: "" };
  }

  const patchFile = join(tmpdir(), `piwood-mergeback-${branchFor(conversationId).replace("/", "-")}.patch`);
  writeFileSync(patchFile, patch, "utf8");
  const apply = await git(["apply", "--3way", "--ignore-whitespace", patchFile], projectDir);

  // 内容复核（T8.0 发现：--3way 可能非零退出但内容已落盘；反之也要防误报成功）
  const unmerged = await git(["diff", "--name-only", "--diff-filter=U"], projectDir);
  const conflictedFiles = unmerged.out.split("\n").map((l) => l.trim()).filter(Boolean);
  if (conflictedFiles.length > 0) {
    // 冲突：不自动合并。用 -R --3way 把这次补丁的索引+工作树改动整体退掉（主树回到 apply 前状态），
    // 改动保留在 worktree 供手工处理；退不干净也只报告，绝不 reset --hard（会毁用户未提交改动）。
    const undo = await git(["apply", "-R", "--3way", "--ignore-whitespace", patchFile], projectDir);
    if (!undo.ok) {
      console.warn(`[worktree] 冲突回退未完全成功（主树可能有残留冲突标记，需手工处理）：${undo.err.split("\n")[0]}`);
    }
    return { status: "conflict", appliedFiles: [], conflictedFiles, untracked, patch };
  }
  if (!apply.ok) {
    return { status: "conflict", appliedFiles: [], conflictedFiles: [], untracked, patch };
  }
  const applied = await git(["diff", "--name-only", `${base || "HEAD"}`], projectDir);
  return {
    status: "applied",
    appliedFiles: applied.out.split("\n").map((l) => l.trim()).filter(Boolean),
    conflictedFiles: [],
    untracked,
    patch,
  };
}

// ---------- 对账（孤儿树） ----------

export interface WorktreeListEntry {
  path: string;
  head?: string;
  branch?: string;
  detached: boolean;
}

/** `git worktree list --porcelain` 解析（纯逻辑，可穷举） */
export function parseWorktreeList(porcelain: string): WorktreeListEntry[] {
  const out: WorktreeListEntry[] = [];
  let cur: Partial<WorktreeListEntry> | undefined;
  const flush = (): void => {
    if (cur?.path) {
      out.push({
        path: cur.path,
        head: cur.head,
        branch: cur.branch,
        detached: cur.detached === true,
      });
    }
  };
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      cur = { path: line.slice("worktree ".length) };
    } else if (cur) {
      if (line.startsWith("HEAD ")) cur.head = line.slice(5);
      else if (line.startsWith("branch ")) cur.branch = line.slice(7).replace(/^refs\/heads\//, "");
      else if (line === "detached") cur.detached = true;
      else if (line === "bare") cur.detached = false;
    }
  }
  flush();
  return out;
}

export interface OrphanReport {
  path: string;
  branch?: string;
}

/**
 * 孤儿对账：本项目管辖范围内（.pi-wood/worktrees + piwood/* 分支）、「不归属任何活跃对话」的树。
 * 只报告不偷删（与 T8.1 残留看门狗同一哲学）；由设置页/用户显式回收。
 */
export async function reconcileOrphans(projectDir: string, activePaths: readonly string[]): Promise<OrphanReport[]> {
  const list = await git(["worktree", "list", "--porcelain"], projectDir);
  if (!list.ok) return [];
  const active = new Set(activePaths.map((p) => p.replace(/[\\/]+$/, "")));
  return parseWorktreeList(list.out)
    .filter((e) => !active.has(e.path.replace(/[\\/]+$/, "")))
    .filter((e) => isManagedWorktree(e.path, e.branch, projectDir))
    .map((e) => ({ path: e.path, branch: e.branch }));
}
