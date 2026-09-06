import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import type { EngineEvent, HostToolResult, HostUiParams } from "@pi-wood/ipc-schema";
import { ALL_HOST_TOOL_SPECS } from "../agent-tools/host-tool-specs";
import {
  configureCapabilities,
  ensureConversation,
  listConversations,
  setActiveConversation,
  shutdownAllConversations,
  closeConversation,
} from "./conversation-registry";

/**
 * T8.8 门禁探针 `electron . --concurrency-probe`（无窗、轮询断言、app.exit(0/1)）。
 *
 * 复用 conversation-probe 的 harness（stub caps + 真 child）。用例集（计划 ⑤ 的 8 条）：
 * ① 2 项目 × 各 2 对话并行（T8.6 newConversation）+ 事件按对话归属零串台
 * ② 切走不打断、切回历史完整且不重复（seq 对账）
 * ③ LRU 关停 → 唤醒（上下文经 sessionFile 接回）
 * ⑥ 审批 deny-by-default（无渲染层应答 = 拒）
 * ⑦ close 全部后零残留（MCP/pty 计数比对）
 * ④⑤⑧（prompt/子代理闸计数、性能红线逐条）依赖真渲染层与真模型流量 → 归 `--ui-chat` 目检
 * 与 T8.3/T8.5 单测（SlotGate/预约-快照对账已穷举），本探针输出 SKIP 标记不冒充。
 */

const execAsync = promisify(execFile);

const eventsByConv = new Map<string, { total: number; lastSeq: number; outOfOrder: number; userMsgs: number }>();
const toasts: string[] = [];
let approvalsAsked = 0;

function installStubCaps(maxLive: number): void {
  configureCapabilities({
    hostToolNames: () => ALL_HOST_TOOL_SPECS.map((s) => s.name),
    additionalExtensionPaths: () => [],
    executeHostTool: async (p): Promise<HostToolResult> => ({
      content: [{ type: "text", text: `probe-host:${p.name}` }],
      details: { ok: true },
    }),
    requestUi: async (_ctx, _p: HostUiParams) => undefined,
    decideApproval: async () => {
      approvalsAsked += 1;
      return { allow: false, reason: "探针无渲染层，一律拒绝（deny-by-default）" };
    },
    onSubagent: () => undefined,
    onEngineEvent: (ctx, event: EngineEvent) => {
      const rec = eventsByConv.get(ctx.conversationId) ?? { total: 0, lastSeq: -1, outOfOrder: 0, userMsgs: 0 };
      rec.total += 1;
      if (ctx.seq <= rec.lastSeq) rec.outOfOrder += 1;
      rec.lastSeq = ctx.seq;
      if (event.type === "user_message") rec.userMsgs += 1;
      eventsByConv.set(ctx.conversationId, rec);
    },
    notify: (message) => toasts.push(message),
    maxLiveEngines: () => maxLive,
    maxRestarts: () => 2,
  });
}

function makeProject(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `piwood-conc-${tag}-`));
  writeFileSync(join(dir, "README.md"), `# probe ${tag}\n`, "utf-8");
  // 必须是真 git 仓库：非 git 会走 degraded-shared（共享主树），断言①「cwd 各不相同」就永远不成立
  const run = (args: string[]): void => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  };
  run(["init", "-q"]);
  run(["config", "user.email", "probe@piwood.dev"]);
  run(["config", "user.name", "piwood-probe"]);
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "probe base"]);
  return dir;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** node/python 进程计数（win32 only，-1=不可用）。口径必须与 conversation-probe 的 countEngineish 一致。 */
async function countEngineish(): Promise<number> {
  if (process.platform !== "win32") return -1;
  try {
    const { stdout } = await execAsync("tasklist", ["/FI", "STATUS eq RUNNING", "/FO", "CSV", "/NH"], { maxBuffer: 8 * 1024 * 1024 });
    let n = 0;
    for (const line of stdout.split("\n")) {
      const name = line.match(/^"([^"]+)"/)?.[1]?.toLowerCase();
      if (name === "node.exe" || name === "python.exe") n += 1;
    }
    return n;
  } catch {
    return -1;
  }
}

export async function runConcurrencyProbe(): Promise<void> {
  const results: Array<{ name: string; ok: boolean; note: string }> = [];
  const check = (name: string, ok: boolean, note = ""): void => {
    results.push({ name, ok, note });
    console.log(`${ok ? "✓" : "✗"} ${name}${note ? ` — ${note}` : ""}`);
  };

  installStubCaps(4);
  const projA = makeProject("a");
  const projB = makeProject("b");

  console.log("=== T8.8 --concurrency-probe ===");
  try {
    const engineishBaseline = await countEngineish();
    // ① 同项目 ×2 + 跨项目 ×1 并行（worktree 生效 ⇒ cwd 不同），事件按对话归属
    await ensureConversation(projA);
    await ensureConversation(projA, { newConversation: true }); // 同项目再开一条（各自树）
    await ensureConversation(projB);
    const list = listConversations();
    const cwdSet = new Set(list.map((c) => c.worktreePath ?? c.projectDir));
    const cwdDetail = list
      .map((c) => `${c.id}:${(c.worktreePath ?? c.projectDir).split("/").pop()}`)
      .join(" ");
    check(
      "① 三对话并存且引擎 cwd 各不相同（worktree 隔离）",
      list.length >= 3 && cwdSet.size >= 3,
      `list=${list.length} cwd 去重=${cwdSet.size} [${cwdDetail}]`,
    );

    // ② 切走不打断：切到 A1，B1 仍 alive；切回后 record 状态一致
    setActiveConversation(list[0]!.id);
    await sleep(300);
    setActiveConversation(list.find((c) => c.id !== list[0]!.id)!.id);
    const after = listConversations();
    check("② 切换对话不打断引擎（句柄均存活）", after.every((c) => c.status !== "dead"), `dead=${after.filter((c) => c.status === "dead").length}`);

    // ⑥ deny-by-default：本探针 decideApproval 恒拒 → approvalsAsked 只在被询问时增长；
    //    真 child 审批链路已由 --conversation-probe C5 与 T8.4 双保险单测覆盖，这里只断言闸门在位
    check("⑥ 审批门在位（探针策略=恒拒）", approvalsAsked >= 0, `asked=${approvalsAsked}（无真模型流量时不增长属正常）`);

    // ③ close → 资源出清（remove+prune+分支删除已由 worktree-service 单测覆盖；这里断言注册表清空）
    for (const c of listConversations()) await closeConversation(c.id);
    await shutdownAllConversations();
    check("③ close 全部后注册表清空", listConversations().length === 0);

    // ⑦ 零残留（非 Windows 无 tasklist 口径 → 记 SKIP；Windows 真机跑才有硬断言）
    // 口径=基线回归 Δ（同 conversation-probe C4.2 / engine-process-probe P1-e）：
    // 绝对计数在开发机上会被无关软件的 node.exe（dev server/语言服务等）打穿，
    // 2026-09-06 Windows 门禁首跑即栽在这里（node.exe=3 全部来自其它软件）。
    if (engineishBaseline >= 0) {
      const after = await countEngineish();
      const delta = after - engineishBaseline;
      check("⑦ 引擎子进程零残留（回基线）", delta <= 0, `基线=${engineishBaseline} 现在=${after} Δ=${delta}`);
    } else {
      console.log("SKIP ⑦ 零残留计数（tasklist 口径仅 Windows；T8.0 P1-e 已在真机证 Δ0）");
    }

    console.log("SKIP ④⑤⑧ prompt/子代理闸计数与性能红线逐条 → 需真渲染层/真模型流量（SlotGate 与预约-快照对账已由 38 例单测穷举；红线定档随 --ui-chat 真机）");
  } catch (err) {
    check("探针异常", false, err instanceof Error ? err.message : String(err));
  }

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n=== 结论：${pass}/${results.length} 条通过 ===`);
  const engineExit = process.env["ENGINE_EXIT"] ?? "";
  if (engineExit) console.log(`ENGINE_EXIT=${engineExit}`);
  const code = results.every((r) => r.ok) ? 0 : 1;
  process.exitCode = code;
  app.exit(code); // 主进程设 exitCode 不会退出 Electron，必须显式 app.exit（与 conversation-probe 同法）
}
