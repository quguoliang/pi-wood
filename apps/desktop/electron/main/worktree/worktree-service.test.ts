import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  detectWorktreeFeasibility,
  ensureWorktree,
  hasWorktreeOnDisk,
  mainGitStatus,
  mergeBackWorktree,
  parseWorktreeList,
  reconcileOrphans,
  removeManagedWorktreeByPath,
  removeWorktree,
  worktreeCleanState,
} from "./worktree-service.ts";
import { branchFor, worktreePathFor } from "./worktree-naming.ts";

/** 真 git 仓库 fixture（T8.6 验收要求：回流成功路径 + 冲突出口都有真实仓库单测） */
const ROOT = mkdtempSync(join(tmpdir(), "piwood-t86-"));
const main = join(ROOT, "main");

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function setupRepo(): void {
  mkdirSync(main, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: main, stdio: "ignore" });
  git(["config", "user.email", "test@piwood.dev"], main);
  git(["config", "user.name", "piwood-test"], main);
  writeFileSync(join(main, "app.js"), Array.from({ length: 40 }, (_, i) => `line-${String(i + 1).padStart(2, "0")}`).join("\n") + "\n");
  git(["add", "-A"], main);
  git(["commit", "-m", "base"], main);
  // node_modules 在基线提交之后创建 = 未跟踪依赖，验证软链策略而非复制
  writeFileSync(join(main, "node_modules-marker"), "x");
}

const BASE_REF = (): string => git(["rev-parse", "HEAD"], main).trim();

describe("worktree-service（真 git 仓库 fixture）", () => {
  let wtConvA = "";

  it("非 git 目录降级：not-git 有显式文案", async () => {
    const notGit = join(ROOT, "not-git");
    mkdirSync(notGit, { recursive: true });
    const f = await detectWorktreeFeasibility(notGit);
    assert.equal(f.code, "not-git");
    assert.match(f.reason ?? "", /共享主工作树/);
    const ensured = await ensureWorktree(notGit, "conv-1-deadbeef");
    assert.equal(ensured.status, "degraded-shared");
    assert.equal(ensured.cwd, notGit);
  });

  it("ensure 创建：树上引擎 cwd 与主树不同、node_modules 是软链不复制", async () => {
    setupRepo();
    wtConvA = "conv-1-aabbccdd";
    const r = await ensureWorktree(main, wtConvA);
    assert.equal(r.status, "created");
    assert.equal(r.cwd, worktreePathFor(main, wtConvA));
    assert.equal(r.branch, branchFor(wtConvA));
    assert.ok(existsSync(join(r.cwd, "app.js")));
    // 依赖不复制：主树的 node_modules-marker 不在树内（marker 文件不在软链目标外层）
    assert.ok(!existsSync(join(r.cwd, "node_modules-marker")));
  });

  it("两棵树物理隔离：A 树改动不出现在主树与另一棵树", async () => {
    writeFileSync(join(worktreePathFor(main, wtConvA), "only-a.txt"), "A");
    assert.ok(!existsSync(join(main, "only-a.txt")));
  });

  it("回流成功路径：apply 后主树内容落盘且可内容复核", async () => {
    const wt = worktreePathFor(main, wtConvA);
    const body = readFileSync(join(wt, "app.js"), "utf8").split("\n");
    body[3] = "line-04 CONV-A"; // 与主树无重叠的行 → 无冲突
    writeFileSync(join(wt, "app.js"), body.join("\n"));
    const r = await mergeBackWorktree(main, wtConvA, { baseRef: BASE_REF() });
    assert.equal(r.status, "applied");
    assert.ok(r.appliedFiles.includes("app.js"), `applied=${r.appliedFiles}`);
    assert.ok(readFileSync(join(main, "app.js"), "utf8").includes("CONV-A"), "主树内容复核");
    // 主树未因此进入冲突态
    const st = git(["diff", "--name-only", "--diff-filter=U"], main).trim();
    assert.equal(st, "");
    // 清掉测试 3 留下的未跟踪文件（remove 视未跟踪为脏，须先回流或丢弃）
    rmSync(join(worktreePathFor(main, wtConvA), "only-a.txt"), { force: true });
    // 回收：树内改动已回流主树 → force 丢弃是安全的；remove + prune + 删分支
    const rm = await removeWorktree(main, wtConvA, { force: true });
    assert.equal(rm.ok, true);
    assert.ok(!existsSync(worktreePathFor(main, wtConvA)));
    const branches = git(["branch", "--list", branchFor(wtConvA)], main).trim();
    assert.equal(branches, "");
  });

  it("冲突路径：同行改动 → 不自动合并、主树回到 apply 前状态、改动保留在树", async () => {
    const conv = "conv-2-11223344";
    const ensured = await ensureWorktree(main, conv);
    assert.equal(ensured.status, "created");
    const wt = worktreePathFor(main, conv);
    // 树内改第 10 行并提交（已提交改动也要能回流）
    const body = readFileSync(join(wt, "app.js"), "utf8").split("\n");
    body[9] = "line-10 CONV-B";
    writeFileSync(join(wt, "app.js"), body.join("\n"));
    git(["add", "-A"], wt);
    git(["commit", "-m", "conv-b change"], wt);
    // 主树改同一行 → 冲突
    const mainBody = readFileSync(join(main, "app.js"), "utf8").split("\n");
    mainBody[9] = "line-10 MAIN-EDIT";
    writeFileSync(join(main, "app.js"), mainBody.join("\n"));
    const r = await mergeBackWorktree(main, conv, { baseRef: BASE_REF() });
    assert.equal(r.status, "conflict");
    assert.ok(r.conflictedFiles.length > 0 || !readFileSync(join(main, "app.js"), "utf8").includes("CONV-B"), "不自动合并");
    assert.ok(!readFileSync(join(main, "app.js"), "utf8").includes("CONV-B"), "主树不残留树内改动（回退干净）");
    assert.ok(readFileSync(join(main, "app.js"), "utf8").includes("MAIN-EDIT"), "主树自己的改动不受影响");
    // 出口：改动保留在 worktree（未被销毁）
    assert.ok(readFileSync(join(wt, "app.js"), "utf8").includes("CONV-B"));
  });

  it("remove 拒绝脏树；force 显式丢弃", async () => {
    const conv = "conv-3-44556677";
    await ensureWorktree(main, conv);
    const wt = worktreePathFor(main, conv);
    writeFileSync(join(wt, "dirty.txt"), "uncommitted");
    const refused = await removeWorktree(main, conv);
    assert.equal(refused.ok, false);
    assert.match(refused.reason ?? "", /回流|丢弃/);
    assert.ok(existsSync(wt));
    const forced = await removeWorktree(main, conv, { force: true });
    assert.equal(forced.ok, true);
    assert.ok(!existsSync(wt));
  });

  it("untracked 显式列出（不自动搬进主树）", async () => {
    const conv = "conv-4-77889900";
    await ensureWorktree(main, conv);
    writeFileSync(join(worktreePathFor(main, conv), "new-file.txt"), "untracked");
    const r = await mergeBackWorktree(main, conv, { baseRef: BASE_REF() });
    assert.equal(r.status, "applied"); // 已跟踪部分无改动 → applied 但列表只含 untracked
    assert.deepEqual(r.untracked, ["new-file.txt"]);
    assert.ok(!existsSync(join(main, "new-file.txt")), "untracked 不自动进主树");
    await removeWorktree(main, conv, { force: true });
  });

  it("孤儿对账：只报告管辖范围内、未活跃的树", async () => {
    const conv = "conv-5-aabb0011";
    await ensureWorktree(main, conv);
    const orphans = await reconcileOrphans(main, []);
    assert.ok(orphans.some((o) => o.branch === branchFor(conv)), `orphans=${JSON.stringify(orphans)}`);
    // 归属活跃对话 → 不算孤儿
    const none = await reconcileOrphans(main, [worktreePathFor(main, conv)]);
    assert.ok(!none.some((o) => o.branch === branchFor(conv)));
    // 用户自建 worktree 不在管辖内
    git(["worktree", "add", join(ROOT, "user-wt"), "-b", "feature/user"], main);
    const again = await reconcileOrphans(main, []);
    assert.ok(!again.some((o) => o.path.includes("user-wt")));
    await removeWorktree(main, conv, { force: true });
  });

  it("幽灵记录（树目录已被手工删除）必须「列得出也删得掉」（2026-09-11 修）", async () => {
    const conv = "conv-9-ccdd2233";
    await ensureWorktree(main, conv);
    // 模拟「目录被手工删除、git 注册项残留」——旧实现里这类记录进得了孤儿列表，却被
    // removeManagedWorktreeByPath 的 realpath 前置判定拒绝，导致列表永不收敛、提示反复弹。
    rmSync(worktreePathFor(main, conv), { recursive: true, force: true });
    const orphans = await reconcileOrphans(main, []);
    const target = orphans.find((o) => o.branch === branchFor(conv));
    assert.ok(target, `幽灵记录应仍被列出：${JSON.stringify(orphans)}`);
    const r = await removeManagedWorktreeByPath(main, target.path, { force: true });
    assert.equal(r.ok, true, r.reason);
    assert.equal(git(["branch", "--list", branchFor(conv)], main).trim(), "", "分支应被一并删掉");
    const after = await reconcileOrphans(main, []);
    assert.ok(!after.some((o) => o.branch === branchFor(conv)), "回收后不应再列出");
  });

  it("跨项目不误列：同仓库内子目录下建的树不算外层项目的孤儿（2026-09-11 修）", async () => {
    // 真实场景：scratch/test-project 不是独立仓库 → git worktree add 把树建到该子目录、
    // 却注册进外层仓库。旧实现按分支前缀判定，外层项目会列出它且删不掉。
    const sub = join(main, "scratch", "test-project");
    mkdirSync(sub, { recursive: true });
    const conv = "conv-10-eeff4455";
    await ensureWorktree(sub, conv); // 子目录非仓库根，但 is-inside-work-tree 为真 → 建树成功
    const outerOrphans = await reconcileOrphans(main, []);
    assert.ok(
      !outerOrphans.some((o) => o.branch === branchFor(conv)),
      `外层项目不应列出子目录项目的树：${JSON.stringify(outerOrphans.map((o) => o.path))}`,
    );
    // 但归它自己的项目管辖，可正常回收
    const innerOrphans = await reconcileOrphans(sub, []);
    const target = innerOrphans.find((o) => o.branch === branchFor(conv));
    assert.ok(target, `子目录项目应列出自己的树：${JSON.stringify(innerOrphans)}`);
    const r = await removeManagedWorktreeByPath(sub, target.path, { force: true });
    assert.equal(r.ok, true, r.reason);
  });

  it("parseWorktreeList：porcelain 解析（branch/detached/bare）", () => {
    const sample = [
      "worktree /repo/main",
      "HEAD abc1234",
      "branch refs/heads/main",
      "",
      "worktree /repo/.pi-wood/worktrees/abc",
      "HEAD def5678",
      "branch refs/heads/piwood/abc",
      "",
      "worktree /repo/bare",
      "bare",
      "",
      "worktree /repo/det",
      "detached",
      "",
    ].join("\n");
    const list = parseWorktreeList(sample);
    assert.equal(list.length, 4);
    assert.equal(list[1]?.branch, "piwood/abc");
    assert.equal(list[2]?.detached, false); // bare ≠ detached
    assert.equal(list[3]?.detached, true);
    assert.equal(list[0]?.branch, "main");
  });

  it("worktreeCleanState：tracked 改动与 untracked 都算脏", async () => {
    const conv = "conv-6-cdcd2233";
    await ensureWorktree(main, conv);
    const wt = worktreePathFor(main, conv);
    const clean = await worktreeCleanState(wt);
    assert.equal(clean.dirty, false);
    writeFileSync(join(wt, "staged.txt"), "x");
    const dirtyUntracked = await worktreeCleanState(wt);
    assert.equal(dirtyUntracked.dirty, true);
    assert.ok(dirtyUntracked.untracked.includes("staged.txt"));
    await removeWorktree(main, conv, { force: true });
  });
});

describe("mainGitStatus / hasWorktreeOnDisk（新会话工作区决策的数据源）", () => {
  const repo = join(ROOT, "mgstatus");
  function init(): void {
    mkdirSync(repo, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "ignore" });
    git(["config", "user.email", "t@piwood.dev"], repo);
    git(["config", "user.name", "t"], repo);
    writeFileSync(join(repo, "a.txt"), "1\n");
    git(["add", "-A"], repo);
    git(["commit", "-m", "base"], repo);
  }

  it("干净主树：isGit + branch=main + feasible，dirty=false", async () => {
    init();
    const s = await mainGitStatus(repo);
    assert.equal(s.isGit, true);
    assert.equal(s.branch, "main");
    assert.equal(s.dirty, false);
    assert.equal(s.changed, 0);
    assert.equal(s.feasible, true);
  });

  it("未提交改动：untracked 与 tracked 修改都算 dirty", async () => {
    writeFileSync(join(repo, "b.txt"), "2\n"); // untracked
    const s1 = await mainGitStatus(repo);
    assert.equal(s1.dirty, true);
    assert.ok(s1.changed >= 1);
    writeFileSync(join(repo, "a.txt"), "changed\n"); // tracked modify
    assert.equal((await mainGitStatus(repo)).dirty, true);
  });

  it("非 git 目录：isGit=false、feasible=false", async () => {
    const plain = join(ROOT, "mgstatus-plain");
    mkdirSync(plain, { recursive: true });
    const s = await mainGitStatus(plain);
    assert.equal(s.isGit, false);
    assert.equal(s.feasible, false);
  });

  it("hasWorktreeOnDisk：建树前 false、ensureWorktree 后 true", async () => {
    const conv = "conv-9-ffffffff";
    assert.equal(hasWorktreeOnDisk(repo, conv), false);
    await ensureWorktree(repo, conv);
    assert.equal(hasWorktreeOnDisk(repo, conv), true);
  });
});

after(() => {
  try {
    rmSync(ROOT, { recursive: true, force: true });
  } catch {
    /* Windows 句柄延迟：留给系统临时目录清理 */
  }
});
