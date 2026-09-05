import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import type { EngineEvent, HostToolResult, HostUiParams, LatencySnapshot } from "@pi-wood/ipc-schema";
import { LATENCY_BUDGETS, budgetVerdict, formatLatencyReport } from "@pi-wood/ipc-schema";
import { ALL_HOST_TOOL_SPECS } from "../agent-tools/host-tool-specs";
import {
  closeConversation,
  configureCapabilities,
  ensureConversation,
  engineLatencySummary,
  getConversation,
  listConversations,
  shutdownAllConversations,
} from "./conversation-registry";

/**
 * T8.9 红线度量探针 `electron . --latency-probe`（无窗、真 child、真 IPC 通道、app.exit(0/1)）。
 *
 * 立它的唯一理由：§7.9 性能红线表里「RPC 往返 / 事件到达 / 审批往返」三行长期**只有预算、没有口径**——
 * 探针没有统计出口，就永远只能写「待真机」。「先有度量，再谈达标」。
 *
 * 三条设计约束：
 * 1. **只量通道，不量模型与人**：ping 是空操作；审批样本只取「未走用户卡」的自动裁决（`auto:true`）；
 *    prompt/steer 这类含模型耗时的命令根本不进 rpcRtt 直方图（取样域由 `isRpcLatencySampled` 定）。
 * 2. **无样本不判达标**：`budgetVerdict()` 对 count=0 直接给不通过并写明未触发；SKIP 的行照旧打 SKIP。
 * 3. **跨进程时钟只用于单跳**：child→main 用同一表达式（`nowEpochMs()`）相减；负值/NaN 由 recorder
 *    拒收并计入 invalid，invalid 占比过高（>10%）判失败——那说明口径本身坏了，不是网络慢。
 */

const PING_SAMPLES = 150; // 每对话
const ECHO_EVENTS = 800; // 合成事件帧（测 child→main 单跳）
const ECHO_APPROVALS = 60; // 审批往返样本（测 child→main→child 反向通道）
const MAX_INVALID_RATIO = 0.1;

function installStubCaps(maxLive: number): void {
  configureCapabilities({
    hostToolNames: () => ALL_HOST_TOOL_SPECS.map((s) => s.name),
    additionalExtensionPaths: () => [],
    executeHostTool: async (p): Promise<HostToolResult> => ({ content: [{ type: "text", text: `probe:${p.name}` }], details: { ok: true } }),
    requestUi: async (_ctx, _p: HostUiParams) => undefined,
    // 探针无渲染层：一律拒绝，但**标 auto**（没弹用户卡 = 这次往返属通道成本，可入 approvalRtt 样本）
    decideApproval: async () => ({ allow: false, reason: "探针恒拒（deny-by-default）", auto: true }),
    onSubagent: () => undefined,
    onEngineEvent: (_ctx, _event: EngineEvent) => undefined,
    notify: () => undefined,
    maxLiveEngines: () => maxLive,
    maxRestarts: () => 0,
  });
}

/** 临时项目必须是真 git 仓库，否则 worktree 降级为共享主树（与 concurrency-probe 同口径） */
function makeProject(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `piwood-lat-${tag}-`));
  writeFileSync(join(dir, "README.md"), `# latency probe ${tag}\n`, "utf-8");
  const run = (args: string[]): void => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  };
  run(["init", "-q"]);
  run(["config", "user.email", "probe@piwood.dev"]);
  run(["config", "user.name", "piwood-latency-probe"]);
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "probe base"]);
  return dir;
}

const invalidRatio = (s: LatencySnapshot): number => (s.count + s.invalid === 0 ? 0 : s.invalid / (s.count + s.invalid));

export async function runLatencyProbe(): Promise<void> {
  // 必须在 ensureConversation 之前设：EngineHost 按当时的 process.env 字符串化后传给 child
  process.env.PIWOOD_ENGINE_PROBE = "1";
  const results: Array<{ name: string; ok: boolean; note: string }> = [];
  const check = (name: string, ok: boolean, note = ""): void => {
    results.push({ name, ok, note });
    console.log(`${ok ? "✓" : "✗"} ${name}${note ? ` — ${note}` : ""}`);
  };

  installStubCaps(3);
  const projA = makeProject("a");
  const projB = makeProject("b");

  console.log("=== T8.9 --latency-probe（红线度量出口） ===");
  try {
    await ensureConversation(projA);
    await ensureConversation(projB);
    const list = listConversations();
    const hostA = getConversation(list[0]!.id)?.host;
    const hostB = getConversation(list[1]!.id)?.host;
    if (!hostA || !hostB) throw new Error("两个对话的 EngineHost 未就位，无法度量");

    // L1 下行只读命令往返：main→child→main（ping 不碰引擎，纯通道）
    for (let i = 0; i < PING_SAMPLES; i += 1) await hostA.invoke("ping", { n: i });
    const aOnly = hostA.latencyReport().rpcRtt;
    const vA = budgetVerdict(aOnly, LATENCY_BUDGETS.rpcRttP95Ms, "rpcRtt(A)");
    check("L1a A 对话 ping 往返 p95 达标（预算取红线表 RPC 行）", vA.ok, vA.note);
    for (let i = 0; i < PING_SAMPLES; i += 1) await hostB.invoke("ping", { n: i });
    const bOnly = hostB.latencyReport().rpcRtt;
    // L1b 每对话独立窗口：A 的样本不涨到 B 头上（跨对话统计串了 = 度量本身不可信）
    check(
      "L1b 统计按对话独立（A/B 各只含自己的 ping 样本）",
      aOnly.count === PING_SAMPLES && bOnly.count === PING_SAMPLES,
      `A=${aOnly.count} B=${bOnly.count}（各 ${PING_SAMPLES}）`,
    );

    // L2 事件帧 child→main 单跳（真 IPC 通道，跨进程 epoch 时间戳）
    await hostA.invoke("debugEcho", { events: ECHO_EVENTS, approvals: 0 });
    const hop = hostA.latencyReport().eventHop;
    const vHop = budgetVerdict(hop, LATENCY_BUDGETS.eventHopP95Ms, "eventHop");
    check("L2 事件到达单跳 child→main p95 达标", vHop.ok, vHop.note);
    check(
      "L2b 跨进程时钟口径可信（拒收的脏样本占比 ≤10%）",
      invalidRatio(hop) <= MAX_INVALID_RATIO,
      `invalid=${hop.invalid}/${hop.count + hop.invalid}（负值=时钟回拨，占比过高说明口径坏了）`,
    );

    // L3 审批往返（child 单时钟自计，只取自动裁决样本）
    await hostA.invoke("debugEcho", { events: 0, approvals: ECHO_APPROVALS });
    await new Promise((r) => setTimeout(r, 200)); // metric 帧在 respond **之后**补发，等它落窗再读快照
    const appr = hostA.latencyReport().approvalRtt;
    const vAppr = budgetVerdict(appr, LATENCY_BUDGETS.approvalRttP95Ms, "approvalRtt");
    check("L3 审批往返（自动裁决路径）p95 达标", vAppr.ok, vAppr.note);

    // L4 聚合视图：合并的是窗口样本，hosts 计数与真实活跃数一致
    const merged = engineLatencySummary();
    check(
      "L4 跨对话聚合可用（hosts 数正确、合并样本 ≥ 单路）",
      merged.hosts === 2 && merged.report.rpcRtt.count >= PING_SAMPLES,
      `hosts=${merged.hosts} 合并 rpcRtt n=${merged.report.rpcRtt.count} p95=${merged.report.rpcRtt.p95}ms`,
    );
    console.log(`  · 聚合摘要：${formatLatencyReport(merged.report)}`);
    console.log(`  · 展示项（不判红线，含宿主真干活时间）：hostToolRtt n=${merged.report.hostToolRtt.count}`);

    // L5 统计随句柄出清：close 全部后不留窗口（否则重启应用会读到上一轮的旧分位数）
    for (const c of listConversations()) await closeConversation(c.id);
    await shutdownAllConversations();
    const after = engineLatencySummary();
    check(
      "L5 close 全部后统计窗口出清（不跨会话污染）",
      after.hosts === 0 && after.report.rpcRtt.count === 0 && after.report.eventHop.count === 0,
      `hosts=${after.hosts} rpcRtt n=${after.report.rpcRtt.count} eventHop n=${after.report.eventHop.count}`,
    );

    console.log(
      `SKIP 切换首屏 ≤${LATENCY_BUDGETS.firstPaintP95Ms}ms / 3 路并发前台体感 / 主进程 CPU → 需真窗口与真模型流量，归 --ui-chat 与人工目检（本探针不合成渲染层）`,
    );
  } catch (err) {
    check("探针异常", false, err instanceof Error ? err.message : String(err));
  }

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n=== 结论：${pass}/${results.length} 条通过 ===`);
  const code = results.every((r) => r.ok) ? 0 : 1;
  process.exitCode = code;
  app.exit(code); // 主进程设 exitCode 不会退出 Electron（与 concurrency-probe 同法）
}
