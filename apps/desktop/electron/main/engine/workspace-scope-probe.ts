import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import type { HostToolResult, HostUiParams } from "@pi-wood/ipc-schema";
import { ALL_HOST_TOOL_SPECS } from "../agent-tools/host-tool-specs";
import {
  closeConversation,
  configureCapabilities,
  ensureConversation,
  getConversation,
  listConversations,
  setActiveConversation,
  shutdownAllConversations,
} from "./conversation-registry";
import { getActiveWorkspaceDir } from "./engine-manager";
import { branchFor, mainProjectRootOf } from "../worktree/worktree-naming";
import { listSessionsAcrossTrees, worktreeTreesOf, type SessionListItem } from "./session-service";
import { resolveTermCwd } from "../workbench/terminal-service";
import { SnapshotService } from "../workbench/snapshot-service";
import { FileWriteQueue } from "../workbench/write-queue";
import { MemoryService } from "../memory/memory-service";

/**
 * T8.7 工作区作用域探针 `electron . --workspace-scope-probe`（无窗、真 child、真 git 树、app.exit(0/1)）。
 *
 * 补的是 T8.7 立项时就写明却从未实现的那件验证工具：**「2 项目 + 同项目两 worktree，
 * 交叉调 fs/git/snapshot/memory/term 断言归属」**。之前只有单测与接线，归属链路在真引擎
 * 真工作树下到底串不串，一直没人证过。
 *
 * 断言全部打在**应用真正跑的那份实现**上（`getActiveWorkspaceDir` / `listSessionsAcrossTrees`
 * / `resolveTermCwd` / `SnapshotService` / `MemoryService` + `mainProjectRootOf`），
 * 探针里不复制第二套判定逻辑——复制品测绿了不等于应用没串。
 */

const execAsync = promisify(execFile);
const git = async (args: string[], cwd: string): Promise<string> => {
  const { stdout } = await execAsync("git", args, { cwd });
  return stdout.trim();
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function installStubCaps(maxLive: number): void {
  configureCapabilities({
    hostToolNames: () => ALL_HOST_TOOL_SPECS.map((s) => s.name),
    additionalExtensionPaths: () => [],
    executeHostTool: async (p): Promise<HostToolResult> => ({ content: [{ type: "text", text: `probe:${p.name}` }], details: {} }),
    requestUi: async (_ctx, _p: HostUiParams) => undefined,
    decideApproval: async () => ({ allow: false, reason: "探针恒拒", auto: true }),
    onSubagent: () => undefined,
    onEngineEvent: () => undefined,
    notify: () => undefined,
    maxLiveEngines: () => maxLive,
    maxRestarts: () => 0,
  });
}

/** 真 git 仓库（非 git 会走 degraded-shared，那是另一条要单独断言的路径） */
function makeGitProject(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `piwood-scope-${tag}-`));
  writeFileSync(join(dir, "README.md"), `# ${tag}\n\nline2\n`, "utf-8");
  const run = (args: string[]): void => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  };
  run(["init", "-q"]);
  run(["config", "user.email", "probe@piwood.dev"]);
  run(["config", "user.name", "piwood-scope-probe"]);
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "base"]);
  return dir;
}

/** 非 git 目录：用来断言「显式降级共享主树」而不是静默分叉 */
function makePlainProject(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `piwood-scope-plain-${tag}-`));
  writeFileSync(join(dir, "README.md"), `# plain ${tag}\n`, "utf-8");
  return dir;
}

const fakeSession = (id: string, modified: string, file: string): SessionListItem => ({
  id,
  file,
  created: modified,
  modified,
  messageCount: 3,
  firstMessage: "probe",
});

export async function runWorkspaceScopeProbe(): Promise<void> {
  const results: Array<{ name: string; ok: boolean; note: string }> = [];
  const check = (name: string, ok: boolean, note = ""): void => {
    results.push({ name, ok, note });
    console.log(`${ok ? "✓" : "✗"} ${name}${note ? ` — ${note}` : ""}`);
  };

  installStubCaps(6);
  const projA = makeGitProject("a");
  const projB = makeGitProject("b");
  const projPlain = makePlainProject("c");

  console.log("=== T8.7 --workspace-scope-probe（作用域归属：fs/git/snapshot/memory/term/sessions） ===");
  try {
    // 三条 git 对话（A 项目两条 = 各占一棵独占树；B 一条）+ 一条非 git（显式降级）
    await ensureConversation(projA);
    await ensureConversation(projA, { newConversation: true });
    await ensureConversation(projB);
    await ensureConversation(projPlain);
    const rows = listConversations();
    const a1 = rows.find((r) => r.projectDir === projA)!;
    const a2 = rows.filter((r) => r.projectDir === projA)[1]!;
    const b1 = rows.find((r) => r.projectDir === projB)!;
    const plain = rows.find((r) => r.projectDir === projPlain)!;
    const treeOf = (id: string): string => getConversation(id)?.worktreePath ?? "";

    // W1 作用域唯一入口随 active 走
    const seen: string[] = [];
    for (const id of [a1.id, a2.id, b1.id]) {
      setActiveConversation(id);
      await sleep(60);
      seen.push(String(getActiveWorkspaceDir()));
    }
    check(
      "W1 getActiveWorkspaceDir 跟着 active 对话走且三棵树互不相同",
      seen[0] === treeOf(a1.id) && seen[1] === treeOf(a2.id) && seen[2] === treeOf(b1.id) && new Set(seen).size === 3,
      seen.map((p) => p.split("/").pop()).join(" / "),
    );
    check(
      "W1b 同项目两对话：projectDir 相同、工作树不同（隔离前提）",
      a1.projectDir === a2.projectDir && a1.worktreePath !== a2.worktreePath,
      `${a1.worktreePath?.split("/").pop()} vs ${a2.worktreePath?.split("/").pop()}`,
    );

    // W2 fs：写进 active 那棵树，别处不存在
    setActiveConversation(a1.id);
    await sleep(60);
    const dirA1 = getActiveWorkspaceDir()!;
    writeFileSync(join(dirA1, "scope-marker-a1.txt"), "only-in-a1\n", "utf-8");
    check(
      "W2 fs 写盘只落 active 那棵树（其余树与主项目都不见）",
      existsSync(join(dirA1, "scope-marker-a1.txt")) &&
        !existsSync(join(treeOf(a2.id), "scope-marker-a1.txt")) &&
        !existsSync(join(treeOf(b1.id), "scope-marker-a1.txt")) &&
        !existsSync(join(projA, "scope-marker-a1.txt")),
      "marker 仅在 A1 树",
    );

    // W3 git 域：分支名与脏状态各自独立
    const branchA1 = await git(["rev-parse", "--abbrev-ref", "HEAD"], dirA1);
    writeFileSync(join(dirA1, "README.md"), "# a\n\nline2 changed by A1\n", "utf-8");
    const dirtyA1 = await git(["status", "--porcelain"], dirA1);
    const dirtyA2 = await git(["status", "--porcelain"], treeOf(a2.id));
    const dirtyMain = await git(["status", "--porcelain"], projA);
    check(
      "W3a A1 的分支就是 piwood/<shortId>（与 worktree-naming 同一判据）",
      branchA1 === branchFor(a1.id),
      `${branchA1} == ${branchFor(a1.id)}`,
    );
    check(
      "W3b A1 改文件不污染 A2 / 主工作树（git status 互不含对方）",
      dirtyA1.includes("README.md") && !dirtyA2.includes("README.md") && !dirtyMain.includes("README.md"),
      `A1 脏=${dirtyA1.split("\n").filter(Boolean).length} 项 · A2 脏=${dirtyA2 ? "1" : "0"} · 主树脏=${dirtyMain ? "1" : "0"}`,
    );

    // W4 快照按树归集：A1 的变更只有 A1 的服务看得见，且 A2 树上的文件内容真没被碰
    //（注意 collectChanges().file 是**相对项目根**的路径，不是绝对路径）
    const snapA1 = new SnapshotService(dirA1);
    const snapA2 = new SnapshotService(treeOf(a2.id));
    snapA1.snapshot("write", { path: "README.md" });
    writeFileSync(join(dirA1, "README.md"), "# a\n\nline2 changed again\n", "utf-8");
    const chA1 = snapA1.collectChanges();
    const chA2 = snapA2.collectChanges();
    const a2Readme = readFileSync(join(treeOf(a2.id), "README.md"), "utf-8");
    check(
      "W4 快照按对话树归集（A1 的变更不进 A2 的服务，A2 树内容未被污染）",
      chA1.length === 1 &&
        chA1[0]!.file === "README.md" &&
        chA2.length === 0 &&
        !a2Readme.includes("changed by A1") &&
        !a2Readme.includes("changed again"),
      `A1 ${chA1.length} 条(${chA1[0]?.file ?? "-"}) · A2 ${chA2.length} 条 · A2 README 原样=${!a2Readme.includes("changed")}`,
    );

    // W5 memory：worktree 对话的记忆必须落到主项目同一份（否则换树就"失忆"）
    const appData = mkdtempSync(join(tmpdir(), "piwood-scope-home-"));
    const queue = new FileWriteQueue();
    let memoryDir = treeOf(a1.id);
    const mem = new MemoryService({
      appDataDir: appData,
      getProjectDir: () => mainProjectRootOf(memoryDir), // 与 memory.ipc 同一注入
    });
    check("W5a mainProjectRootOf 把树路径归到主项目", mainProjectRootOf(treeOf(a1.id)) === projA, `${treeOf(a1.id).split("/").pop()} → ${projA.split("/").pop()}`);
    memoryDir = treeOf(a1.id);
    mem.save({ type: "fact", title: "来自 A1 树", body: "a1", scope: "project" });
    memoryDir = treeOf(a2.id);
    mem.save({ type: "fact", title: "来自 A2 树", body: "a2", scope: "project" });
    const projMemFile = join(projA, ".pi-wood", "memory", "project.json");
    const savedTitles = existsSync(projMemFile)
      ? (JSON.parse(readFileSync(projMemFile, "utf-8")) as Array<{ title?: string }>).map((i) => i.title ?? "")
      : [];
    check(
      "W5b 两条对话的记忆都落主项目同一文件、都不丢",
      existsSync(projMemFile) && savedTitles.length === 2 && savedTitles.includes("来自 A1 树") && savedTitles.includes("来自 A2 树"),
      `project.json ${savedTitles.length} 条`,
    );

    // W6 并发写不丢更新（read-modify-write 全量覆盖的老毛病，靠 FileWriteQueue 兜）
    memoryDir = treeOf(a1.id);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        queue.withLock("memory", async () => {
          mem.save({ type: "fact", title: `并发 ${i}`, body: `b${i}`, scope: "project" });
        }),
      ),
    );
    const after = (JSON.parse(readFileSync(projMemFile, "utf-8")) as Array<{ title?: string }>).map((i) => i.title ?? "");
    check(
      "W6 八路并发 memory_save 一条不丢（写队列串行化生效）",
      after.length === 10 && Array.from({ length: 8 }, (_, i) => `并发 ${i}`).every((t) => after.includes(t)),
      `${after.length} 条（期望 10）`,
    );

    // W7 sessions 聚合：主项目 + 全部 worktree 一起列，同 id 去重、modified 新→旧
    const trees = worktreeTreesOf(projA);
    const lister = async (cwd: string): Promise<SessionListItem[]> => {
      if (cwd === projA) return [fakeSession("s-old", "2026-01-01T00:00:00.000Z", join(cwd, "s-old.jsonl")), fakeSession("s-dup", "2026-02-01T00:00:00.000Z", join(cwd, "s-dup.jsonl"))];
      if (cwd === treeOf(a1.id)) return [fakeSession("s-new", "2026-09-05T00:00:00.000Z", join(cwd, "s-new.jsonl")), fakeSession("s-dup", "2026-03-01T00:00:00.000Z", join(cwd, "s-dup2.jsonl"))];
      return [];
    };
    const merged = await listSessionsAcrossTrees(projA, lister);
    check(
      "W7a 聚合覆盖主项目 + 每条对话的树",
      trees.length >= 3 && trees.includes(projA) && trees.includes(treeOf(a1.id)) && trees.includes(treeOf(a2.id)),
      `${trees.length} 棵树`,
    );
    check(
      "W7b 同 id 去重、按 modified 新→旧（CLI↔桌面互通的左栏硬证据）",
      merged.length === 3 && merged[0]!.id === "s-new" && merged[1]!.id === "s-dup" && merged[2]!.id === "s-old",
      merged.map((s) => `${s.id}@${s.modified.slice(0, 10)}`).join(" → "),
    );

    // W8 终端 cwd 解析（不真起 pty，只断言归属解析）
    const lookup = (id: string): string | undefined => getConversation(id)?.worktreePath;
    check(
      "W8 终端 cwd = 该对话的树；无对话 id / 查不到树时保留请求值",
      resolveTermCwd("/some/where", a1.id, lookup) === treeOf(a1.id) &&
        resolveTermCwd("/some/where", undefined, lookup) === "/some/where" &&
        resolveTermCwd("/some/where", "no-such-conv", lookup) === "/some/where",
      `A1 → ${treeOf(a1.id).split("/").pop()}`,
    );

    // W9 非 git 项目：显式降级共享主树，不静默分叉出第二套作用域
    setActiveConversation(plain.id);
    await sleep(60);
    check(
      "W9 非 git 目录显式降级（worktreePath = 主项目，作用域不悬空）",
      plain.worktreePath === plain.projectDir && getActiveWorkspaceDir() === projPlain,
      `worktreePath=${plain.worktreePath === projPlain ? "= 主项目" : String(plain.worktreePath)}`,
    );

    // W10 close 之后 active 作用域不指向已回收的树
    setActiveConversation(a1.id);
    await closeConversation(a2.id);
    await sleep(120);
    const afterClose = getActiveWorkspaceDir();
    check(
      "W10 关闭对话后作用域不悬空（不指向已回收的树）",
      afterClose === treeOf(a1.id) && afterClose !== treeOf(a2.id),
      `active → ${afterClose?.split("/").pop()}`,
    );
  } catch (err) {
    check("探针异常", false, err instanceof Error ? err.message : String(err));
  } finally {
    for (const c of listConversations()) await closeConversation(c.id).catch(() => undefined);
    await shutdownAllConversations().catch(() => undefined);
  }

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n=== 结论：${pass}/${results.length} 条通过 ===`);
  const code = pass === results.length ? 0 : 1;
  process.exitCode = code;
  app.exit(code); // 主进程设 exitCode 不会退出 Electron
}
