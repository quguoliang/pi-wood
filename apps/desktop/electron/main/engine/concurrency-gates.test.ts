import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SlotGate,
  applyRunsSnapshot,
  clampLimit,
  dropChildRunState,
  effectivePromptLimit,
  newChildRunGateState,
  normalizeQuotaAction,
  planChildRunAdmit,
  planGoalBegin,
  quotaGuardEffect,
  releaseChildRunReservation,
  reserveChildRun,
} from "./concurrency-gates.ts";

describe("clampLimit", () => {
  it("非法输入回落默认值（空串/0/null 不静默变 1）", () => {
    assert.equal(clampLimit(undefined, 3, 1, 6), 3);
    assert.equal(clampLimit(null, 3, 1, 6), 3);
    assert.equal(clampLimit("", 3, 1, 6), 3);
    assert.equal(clampLimit(Number.NaN, 3, 1, 6), 3);
  });
  it("合法输入 clamp 进区间", () => {
    assert.equal(clampLimit(99, 3, 1, 6), 6);
    assert.equal(clampLimit(0, 3, 1, 6), 1);
    assert.equal(clampLimit("4", 3, 1, 6), 4);
    assert.equal(clampLimit(2.9, 3, 1, 6), 2);
  });
});

describe("effectivePromptLimit（与活跃引擎数取交集 + 限流降 1）", () => {
  it("取 min(prompt 上限, 引擎上限)", () => {
    assert.equal(effectivePromptLimit(6, 3), 3);
    assert.equal(effectivePromptLimit(2, 4), 2);
  });
  it("限流退避 → 1", () => {
    assert.equal(effectivePromptLimit(6, 4, { rateLimited: true }), 1);
  });
});

describe("SlotGate（FIFO 槽位闸）", () => {
  it("限额内直接进、不排队", async () => {
    const g = new SlotGate(2);
    assert.equal(await g.acquire(), false);
    assert.equal(await g.acquire(), false);
    assert.equal(g.stats().running, 2);
  });
  it("超限排队，release 后按 FIFO 唤醒", async () => {
    const g = new SlotGate(1);
    await g.acquire();
    const order: number[] = [];
    const p1 = g.acquire().then((q) => (order.push(1), q));
    const p2 = g.acquire().then((q) => (order.push(2), q));
    assert.equal(g.stats().queued, 2);
    g.release();
    await p1;
    g.release();
    await p2;
    assert.deepEqual(order, [1, 2]);
    assert.equal(g.stats().running, 1); // p2 仍持槽
    g.release();
    assert.equal(g.stats().running, 0);
  });
  it("setLimit 收紧后 wouldQueue 反映新限额；放宽唤醒等待者", async () => {
    const g = new SlotGate(2);
    await g.acquire();
    await g.acquire();
    g.setLimit(1);
    assert.equal(g.wouldQueue(), true);
    const p = g.acquire();
    g.setLimit(3); // 放宽 → 等待者被唤醒
    assert.equal(await p, true);
  });
  it("release 不跌破 0", () => {
    const g = new SlotGate(2);
    g.release();
    g.release();
    assert.equal(g.stats().running, 0);
  });
});

describe("子代理全局闸（预约-快照对账）", () => {
  it("限额内 admit", () => {
    const s = newChildRunGateState();
    assert.deepEqual(planChildRunAdmit(s, "conv-a", { perConversation: 4, global: 6 }), { action: "admit" });
  });
  it("per-对话超限 → queue（原因可读）", () => {
    const s = newChildRunGateState();
    for (let i = 0; i < 4; i++) reserveChildRun(s, "conv-a");
    const plan = planChildRunAdmit(s, "conv-a", { perConversation: 4, global: 6 });
    assert.equal(plan.action, "queue");
    if (plan.action === "queue") assert.match(plan.reason, /该对话/);
  });
  it("全局超限（跨对话合计）→ queue", () => {
    const s = newChildRunGateState();
    for (let i = 0; i < 3; i++) reserveChildRun(s, "conv-a");
    for (let i = 0; i < 3; i++) reserveChildRun(s, "conv-b");
    const plan = planChildRunAdmit(s, "conv-c", { perConversation: 4, global: 6 });
    assert.equal(plan.action, "queue");
    if (plan.action === "queue") assert.match(plan.reason, /全局/);
  });
  it("预约在快照转 running 后折算，run 结束自然释放", () => {
    const s = newChildRunGateState();
    reserveChildRun(s, "conv-a"); // acquire 放行
    assert.equal(applyRunsSnapshot(s, "conv-a", 0), 0); // 快照还没到
    assert.equal((s.reserved["conv-a"] ?? 0), 1); // 预约仍占用
    assert.equal(applyRunsSnapshot(s, "conv-a", 1), 1); // run 启动 → 预约折算
    assert.equal((s.reserved["conv-a"] ?? 0), 0);
    assert.equal(s.running["conv-a"], 1);
    applyRunsSnapshot(s, "conv-a", 0); // run 结束
    assert.equal(s.running["conv-a"], 0);
    assert.deepEqual(planChildRunAdmit(s, "conv-a", { perConversation: 1, global: 6 }), { action: "admit" });
  });
  it("审批被拒显式退还预约", () => {
    const s = newChildRunGateState();
    reserveChildRun(s, "conv-a");
    releaseChildRunReservation(s, "conv-a");
    assert.deepEqual(planChildRunAdmit(s, "conv-a", { perConversation: 1, global: 1 }), { action: "admit" });
  });
  it("多对话互不串账 + dropChildRunState 出清", () => {
    const s = newChildRunGateState();
    reserveChildRun(s, "conv-a");
    reserveChildRun(s, "conv-b");
    assert.deepEqual(planChildRunAdmit(s, "conv-c", { perConversation: 1, global: 3 }), { action: "admit" });
    dropChildRunState(s, "conv-a");
    assert.deepEqual(planChildRunAdmit(s, "conv-c", { perConversation: 1, global: 2 }), { action: "admit" });
  });
});

describe("goal 互斥", () => {
  it("无其它 active → 放行", () => {
    assert.deepEqual(planGoalBegin([], "s1"), { ok: true });
    assert.deepEqual(planGoalBegin(["s1"], "s1"), { ok: true });
  });
  it("其它对话已 active → 冲突但可强制接管", () => {
    const plan = planGoalBegin(["s1"], "s2");
    assert.equal(plan.ok, false);
    if (!plan.ok) {
      assert.equal(plan.conflictSessionId, "s1");
      assert.equal(plan.canForce, true);
    }
  });
});

describe("配额动作", () => {
  it("归一：非法值回落 warn", () => {
    assert.equal(normalizeQuotaAction("throttle"), "throttle");
    assert.equal(normalizeQuotaAction("block"), "block");
    assert.equal(normalizeQuotaAction("whatever"), "warn");
    assert.equal(normalizeQuotaAction(undefined), "warn");
  });
  it("未超限 → 什么动作都不触发", () => {
    assert.deepEqual(quotaGuardEffect("block", false), { throttle: false, blockNewConversation: false });
  });
  it("超限按设置生效", () => {
    assert.deepEqual(quotaGuardEffect("throttle", true), { throttle: true, blockNewConversation: false });
    assert.deepEqual(quotaGuardEffect("block", true), { throttle: false, blockNewConversation: true });
    assert.deepEqual(quotaGuardEffect("warn", true), { throttle: false, blockNewConversation: false });
  });
});
