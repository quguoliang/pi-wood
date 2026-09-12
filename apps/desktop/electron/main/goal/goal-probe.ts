import { app } from "electron";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  beginGoal,
  clearGoalFor,
  configureGoalRuntime,
  getGoalState,
  onGoalSettled,
  pauseGoal,
  resumeGoal,
  type GoalAdapter,
} from "./goal-runtime.ts";
import type { AuditResult } from "./goal-prompt.ts";
import type { GoalState } from "@pi-wood/ipc-schema";

/**
 * T7.5 目标模式 headless 探针（仿 plugin-probe）。
 * 不建窗口、不加载引擎/真实模型：注入 fake GoalAdapter + 脚本 Auditor，驱动 goal-runtime 跑确定性全链路。
 * 断言：① 自动续跑发 prompt ② token 预算耗尽 → budgetLimited 停 ③ 轮次上限 → blocked 停
 *      ④ 审计 complete → 终态 ⑤ pause→settle 幂等 no-op→resume 回 active ⑥ 目标正文/状态落文件
 *      ⑦ 用户 abort 本轮 → 暂停 ⑧ T8.5 互斥跨重启仍生效（落盘遗留 active 目标不得遁形）
 * 触发：electron out/main/index.js --goal-probe   （EXIT 0=全过 / 1=失败）
 */
export function isGoalProbeMode(): boolean {
  return process.argv.includes("--goal-probe");
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const line = (tag: string, msg: string): void => console.log(`[goal-probe] ${tag} ${msg}`);

function makeAuditor(verdict: AuditResult["verdict"]): (o: string, a: string) => Promise<AuditResult | undefined> {
  return async () => ({ verdict, note: `probe:${verdict}` });
}

export async function runGoalProbe(): Promise<void> {
  const results: Array<{ name: string; pass: boolean; detail: string }> = [];
  const check = (name: string, pass: boolean, detail: string): void => {
    results.push({ name, pass, detail });
    line(pass ? "✓" : "✗", `${name} — ${detail}`);
  };

  try {
    const dir = mkdtempSync(join(tmpdir(), "pi-wood-goal-probe-"));
    configureGoalRuntime({ appDataDir: dir, sendToRenderer: () => {} });
    const sid = "probe-session";

    let tokens = 0;
    const sent: string[] = [];
    const adapter: GoalAdapter = {
      sessionId: sid,
      prompt: async (t) => {
        sent.push(t);
      },
      stats: async () => ({ totalTokens: tokens, costUsd: 0 }),
    };

    // ① 自动续跑：begin → settle(continue) → 应发出 continuation prompt 且 turnsUsed+1
    beginGoal(sid, "在 README 里加一行测试文字", { tokenBudget: 100, maxTurns: 20, initialTotalTokens: 0 });
    tokens = 40;
    await onGoalSettled(adapter, "我加了一行", { auditor: makeAuditor("continue") });
    const s1 = getGoalState(sid) as GoalState;
    check("自动续跑发 prompt", s1.status === "active" && s1.turnsUsed === 1 && sent.length === 1 && /目标模式 · 自动续跑/.test(sent[0] ?? ""), `status=${s1.status} turns=${s1.turnsUsed} sent=${sent.length}`);

    // ② token 预算耗尽 → budgetLimited，不再续跑
    tokens = 100; // delta 60 → tokensUsed 100 >= budget 100
    await onGoalSettled(adapter, "继续", { auditor: makeAuditor("continue") });
    const s2 = getGoalState(sid) as GoalState;
    check("token 预算耗尽停", s2.status === "budgetLimited" && s2.tokensUsed >= 100 && sent.length === 1, `status=${s2.status} tokensUsed=${s2.tokensUsed} sent=${sent.length}`);

    // ③ 轮次上限 → blocked（budget 放开、maxTurns=3，第 4 次 settle 命中上限）
    clearGoalFor(sid);
    beginGoal(sid, "刷满轮次", { tokenBudget: 1_000_000, maxTurns: 3, initialTotalTokens: 0 });
    tokens = 0;
    for (let i = 0; i < 3; i++) {
      tokens += 1;
      await onGoalSettled(adapter, "step", { auditor: makeAuditor("continue") });
    }
    const sCapActive = getGoalState(sid) as GoalState;
    tokens += 1;
    await onGoalSettled(adapter, "step", { auditor: makeAuditor("continue") });
    const s3 = getGoalState(sid) as GoalState;
    check("轮次上限 blocked", s3.status === "blocked" && s3.turnsUsed === 3, `前三轮后 turns=${sCapActive.turnsUsed}/${sCapActive.maxTurns} 第4次 status=${s3.status}`);

    // ④ 审计 complete → 终态 complete + 不再续跑
    clearGoalFor(sid);
    beginGoal(sid, "完成即停", { tokenBudget: 1_000_000, maxTurns: 20, initialTotalTokens: 0 });
    const sentBefore = sent.length;
    await onGoalSettled(adapter, "目标已完成", { auditor: makeAuditor("complete") });
    const s4 = getGoalState(sid) as GoalState;
    check("complete 终止", s4.status === "complete" && sent.length === sentBefore, `status=${s4.status} note=${s4.note}`);

    // ⑤ pause → settle 幂等 no-op → resume 回 active
    clearGoalFor(sid);
    beginGoal(sid, "暂停恢复", { tokenBudget: 1_000_000, maxTurns: 20, initialTotalTokens: 0 });
    pauseGoal(sid);
    const sentAtPause = sent.length;
    await onGoalSettled(adapter, "x", { auditor: makeAuditor("continue") });
    const pausedStill = getGoalState(sid) as GoalState;
    resumeGoal(sid);
    const resumed = getGoalState(sid) as GoalState;
    check("暂停幂等 + 恢复", pausedStill.status === "paused" && sent.length === sentAtPause && resumed.status === "active", `paused=${pausedStill.status} resumed=${resumed.status}`);

    // ⑥ 目标正文/状态已落文件（goalsDir 建 <dir>/goals/ 子目录）
    const filesNow = readdirSync(join(dir, "goals"));
    check("状态与正文落文件", filesNow.some((f) => f.endsWith(".md")) && filesNow.some((f) => f.endsWith(".state.json")), filesNow.join(","));

    // ⑦ 用户 abort 本轮 → 暂停（非受阻）
    clearGoalFor(sid);
    beginGoal(sid, "abort→pause", { tokenBudget: 1_000_000, maxTurns: 20, initialTotalTokens: 0 });
    await onGoalSettled(adapter, "（被中断）", { aborted: true, auditor: makeAuditor("continue") });
    const sAbort = getGoalState(sid) as GoalState;
    check("abort→暂停", sAbort.status === "paused", `status=${sAbort.status}`);

    // ⑧ T8.5 互斥跨重启：落盘遗留的 active 目标必须仍能拦住新目标。
    // 「模拟重启」= 重配 runtime（清内存视图 + 按 goalsDir 重新预热）；若预热缺失，
    // 遗留 active 对 listActiveGoalSessions() 不可见 → 两对话可在盘上并存 active（成本乘积失控）。
    clearGoalFor(sid);
    beginGoal("legacy-session", "重启前遗留的目标", { tokenBudget: 1_000_000, maxTurns: 20, initialTotalTokens: 0 });
    configureGoalRuntime({ appDataDir: dir, sendToRenderer: () => {} });
    let mutexBlocked = false;
    try {
      beginGoal("another-session", "新会话的目标", { tokenBudget: 1_000_000, maxTurns: 20, initialTotalTokens: 0 });
    } catch {
      mutexBlocked = true;
    }
    check(
      "跨重启互斥仍生效",
      mutexBlocked,
      mutexBlocked ? "遗留 active 目标已拦截新目标" : "遗留 active 目标未被计入互斥（盘上可并存两个 active）",
    );
  } catch (e) {
    line("!", `探针异常：${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    results.push({ name: "异常", pass: false, detail: String(e) });
  }

  const allPass = results.length > 0 && results.every((r) => r.pass);
  line("=", `${results.filter((r) => r.pass).length}/${results.length} 通过 · 结论 ${allPass ? "ALL PASS" : "FAIL"}`);
  await sleep(200);
  app.exit(allPass ? 0 : 1);
}
