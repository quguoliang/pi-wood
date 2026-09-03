import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceGoal, newGoalState, BLOCKED_LIMIT, AUDIT_FAIL_LIMIT, type TickInput } from "./goal-machine.ts";
import type { GoalState } from "@pi-wood/ipc-schema";

const base = (): GoalState => newGoalState("s1", 40, 20, 1000);
const tick = (over: Partial<TickInput>): TickInput => ({ totalTokens: 0, costUsd: 0, audit: { verdict: "continue" }, ...over });

test("active + continue → turnsUsed+1、effect=continue", () => {
  const { state, effect } = advanceGoal(base(), tick({ totalTokens: 100, audit: { verdict: "continue", note: "在做 x" } }));
  assert.equal(effect.type, "continue");
  assert.equal(state.turnsUsed, 1);
  assert.equal(state.tokensUsed, 100);
  assert.equal(state.status, "active");
});

test("complete → 终态 complete + notify", () => {
  const { state, effect } = advanceGoal(base(), tick({ audit: { verdict: "complete", note: "目标达成" } }));
  assert.equal(state.status, "complete");
  assert.equal(state.note, "目标达成");
  assert.deepEqual(effect, { type: "notify", kind: "complete", note: "目标达成" });
});

test("blocked 连续 BLOCKED_LIMIT 次才终止；未达阈值继续观察", () => {
  let s = base();
  for (let i = 1; i < BLOCKED_LIMIT; i++) {
    const r = advanceGoal(s, tick({ audit: { verdict: "blocked", note: "卡住" } }));
    s = r.state;
    assert.equal(r.effect.type, "continue"); // 未达阈值 → 继续
    assert.equal(s.status, "active");
  }
  const r = advanceGoal(s, tick({ audit: { verdict: "blocked" } }));
  assert.equal(r.state.status, "blocked");
  assert.equal(r.effect.type, "notify");
});

test("成功 continue 会清零 consecutiveBlocked", () => {
  let s = advanceGoal(base(), tick({ audit: { verdict: "blocked" } })).state;
  assert.equal(s.consecutiveBlocked, 1);
  s = advanceGoal(s, tick({ audit: { verdict: "continue" } })).state;
  assert.equal(s.consecutiveBlocked, 0);
});

test("token 预算耗尽 → budgetLimited + notify（优先于审计裁决）", () => {
  const s = { ...base(), lastTotalTokens: 900 };
  const r = advanceGoal(s, tick({ totalTokens: 1000, audit: { verdict: "continue" } })); // 累计 100≥budget? 用满
  // tokensUsed=100, budget=1000 → 未超；改测超预算：
  assert.equal(r.state.tokensUsed, 100);
  const r2 = advanceGoal({ ...base(), tokensUsed: 1000, lastTotalTokens: 0 }, tick({ totalTokens: 0, audit: { verdict: "continue" } }));
  assert.equal(r2.state.status, "budgetLimited");
  assert.equal(r2.effect.type, "notify");
});

test("token 增量单调：读数下降（compaction）不减 tokensUsed", () => {
  const s = { ...base(), tokensUsed: 300, lastTotalTokens: 500 };
  const r = advanceGoal(s, tick({ totalTokens: 120 /* 变小 */, audit: { verdict: "continue" } }));
  assert.equal(r.state.tokensUsed, 300); // delta=max(0,120-500)=0
  assert.equal(r.state.lastTotalTokens, 120); // baseline 仍跟到新值
});

test("assistantError 计入受阻（不直接终止）", () => {
  const r = advanceGoal(base(), tick({ assistantError: true }));
  assert.equal(r.state.consecutiveBlocked, 1);
  assert.equal(r.effect.type, "continue");
});

test("审计失败容忍 1 次（stay active, none），第 2 次连续 → auditUnavailable + notify", () => {
  const first = advanceGoal(base(), tick({ auditFailed: true }));
  assert.equal(first.state.status, "active");
  assert.equal(first.state.auditFailures, 1);
  assert.equal(first.effect.type, "none");
  const second = advanceGoal(first.state, tick({ auditFailed: true }));
  assert.equal(second.state.status, "auditUnavailable");
  assert.equal(second.effect.type, "notify");
  assert.equal(AUDIT_FAIL_LIMIT, 2);
});

test("审计成功后 auditFailures 归零", () => {
  let s = advanceGoal(base(), tick({ auditFailed: true })).state;
  s = advanceGoal(s, tick({ audit: { verdict: "continue" } })).state;
  assert.equal(s.auditFailures, 0);
});

test("轮次上限：turnsUsed>=maxTurns → blocked + notify，不再续跑", () => {
  const s = { ...base(), turnsUsed: 20 };
  const r = advanceGoal(s, tick({ audit: { verdict: "continue" } }));
  assert.equal(r.state.status, "blocked");
  assert.equal(r.effect.type, "notify");
  assert.equal(r.state.turnsUsed, 20); // 未再 +1
});

test("非 active（paused/complete）→ 幂等 no-op，不耗轮次", () => {
  const paused = { ...base(), status: "paused" as const };
  const r = advanceGoal(paused, tick({ totalTokens: 500, audit: { verdict: "continue" } }));
  assert.equal(r.effect.type, "none");
  assert.equal(r.state.turnsUsed, 0);
  assert.equal(r.state.tokensUsed, 0); // 未累计
  assert.equal(r.state.status, "paused");
});

test("note 归一化换行 + 截断 ≤280", () => {
  const long = "x".repeat(400);
  const r = advanceGoal(base(), tick({ audit: { verdict: "continue", note: `a\n b   ${long}` } }));
  assert.ok((r.state.note?.length ?? 0) <= 280);
  assert.ok(!r.state.note?.includes("\n"));
});
