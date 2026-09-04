/**
 * conversation-core 纯逻辑单元测试（T8.1 验收）
 * 风格对齐 packages/engine/src/event-bridge.test.ts：平铺 test + 中文标题，
 * 标题写「保证」（验收项）而不是「函数 X works」。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEventSeq,
  canRecover,
  canTransition,
  isLive,
  isSuspendSafe,
  LIVE_STATUSES,
  normalizeMaxLiveEngines,
  pickSuspendCandidate,
  planAdmit,
  planRestart,
  RESTING_STATUSES,
  summarizeConversations,
  transition,
  type ConversationRecord,
  type ConversationStatus,
} from "./conversation-core.ts";

const ALL_STATUSES: ConversationStatus[] = [
  "spawning",
  "idle",
  "streaming",
  "waiting_approval",
  "queued",
  "suspended",
  "dead",
];

function rec(over: Partial<ConversationRecord> & { id: string }): ConversationRecord {
  return {
    projectDir: "/tmp/p",
    status: "idle",
    lastActiveAt: 0,
    lastSeq: 0,
    droppedEvents: 0,
    inFlightPrompt: false,
    pendingApprovals: 0,
    restarts: 0,
    ...over,
  };
}

// ---------- 状态机 ----------

// 期望矩阵 = 手抄 TRANSITIONS 表，再叠加两条恒放行规则（同态自迁移、任意→dead）
const LEGAL_FROM: Record<ConversationStatus, ConversationStatus[]> = {
  spawning: ["spawning", "idle", "streaming", "waiting_approval", "dead"],
  idle: ["idle", "streaming", "queued", "spawning", "suspended", "dead"],
  streaming: ["streaming", "idle", "waiting_approval", "queued", "dead"],
  waiting_approval: ["waiting_approval", "streaming", "idle", "queued", "dead"],
  queued: ["queued", "streaming", "idle", "dead"],
  suspended: ["suspended", "spawning", "dead"],
  // dead 可复活：重新 fork 或直接落到任一在跑/休眠态
  dead: ["dead", "spawning", "idle", "streaming", "waiting_approval", "queued", "suspended"],
};

test("状态机穷举：7×7 矩阵中恰好 35 对合法迁移，与 TRANSITIONS+同态+任意→dead 三条规则一致", () => {
  let legal = 0;
  let illegal = 0;
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      const want = LEGAL_FROM[from].includes(to);
      assert.equal(canTransition(from, to), want, `${from} → ${to} 应为 ${want ? "合法" : "非法"}`);
      if (want) legal += 1;
      else illegal += 1;
    }
  }
  assert.equal(legal, 35);
  assert.equal(illegal, 14);
});

test("transition 放行全部合法迁移并返回目标状态，拒绝全部非法迁移并抛错（宁可炸不静默卡死）", () => {
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      if (LEGAL_FROM[from].includes(to)) {
        assert.equal(transition(from, to), to);
      } else {
        assert.throws(() => transition(from, to), { message: new RegExp(`非法对话状态迁移 ${from} → ${to}`) });
      }
    }
  }
});

test("崩溃兜底：任何状态都能直达 dead；dead 是唯一可复活态", () => {
  for (const from of ALL_STATUSES) {
    assert.ok(canTransition(from, "dead"), `${from} → dead 必须放行`);
  }
  for (const to of ALL_STATUSES) {
    assert.ok(canTransition("dead", to), `dead → ${to} 必须放行（一键恢复）`);
  }
});

test("streaming 中的对话永不被直接休眠：suspended 只能从 idle 或 dead 进入", () => {
  assert.ok(!canTransition("streaming", "suspended"));
  assert.ok(!canTransition("queued", "suspended"));
  assert.ok(!canTransition("waiting_approval", "suspended"));
  assert.ok(!canTransition("spawning", "suspended"));
  assert.ok(canTransition("idle", "suspended"));
  assert.ok(canTransition("suspended", "spawning"));
});

// ---------- seq 对账（丢帧不静默） ----------

test("seq 恰好 +1 的连续帧被接受且不产生丢帧计数", () => {
  const out = applyEventSeq({ lastSeq: 4, droppedEvents: 0 }, 5);
  assert.deepEqual(out, { lastSeq: 5, droppedEvents: 0, accepted: true, gap: 0 });
});

test("gap=N 的帧：droppedEvents 精确 +N 且 lastSeq 仍前进（丢帧必须可见，不静默）", () => {
  const out = applyEventSeq({ lastSeq: 0, droppedEvents: 0 }, 4);
  assert.equal(out.accepted, true);
  assert.equal(out.gap, 3);
  assert.equal(out.lastSeq, 4);
  assert.equal(out.droppedEvents, 3);
  // 已有基数也要正确累加
  const out2 = applyEventSeq({ lastSeq: 4, droppedEvents: 7 }, 9);
  assert.equal(out2.droppedEvents, 7 + 4);
});

test("重复帧（seq 相等）与乱序旧帧（seq 更小）被拒绝：lastSeq 不回退也不计丢帧", () => {
  const dup = applyEventSeq({ lastSeq: 6, droppedEvents: 2 }, 6);
  assert.deepEqual(dup, { lastSeq: 6, droppedEvents: 2, accepted: false, gap: 0 });
  const stale = applyEventSeq({ lastSeq: 6, droppedEvents: 2 }, 3);
  assert.deepEqual(stale, { lastSeq: 6, droppedEvents: 2, accepted: false, gap: 0 });
});

test("非整数/负数/Infinity/NaN 等畸形 seq 一律拒绝且保持原状态", () => {
  for (const bad of [-1, -100, 1.5, NaN, Infinity, -Infinity]) {
    const out = applyEventSeq({ lastSeq: 2, droppedEvents: 1 }, bad);
    assert.deepEqual(out, { lastSeq: 2, droppedEvents: 1, accepted: false, gap: 0 }, `seq=${bad} 应被拒绝`);
  }
});

test("同一帧重复应用不会双计丢帧（纯函数：输入不被改写，重放只被拒）", () => {
  const input = { lastSeq: 3, droppedEvents: 1 };
  const snapshot = { ...input };
  const first = applyEventSeq(input, 9); // gap=5 → dropped=6
  assert.deepEqual(input, snapshot, "applyEventSeq 必须是纯函数，不得修改入参");
  const replay = applyEventSeq(first, 9);
  assert.equal(replay.accepted, false);
  assert.equal(replay.droppedEvents, first.droppedEvents, "重放同一 seq 不得再次累加丢帧");
  assert.equal(replay.lastSeq, 9);
});

// ---------- LRU 自动休眠选人 ----------

test("只有轮次边界上的 idle 才可被自动休眠（in-flight prompt 或待审批一律不安全）", () => {
  assert.ok(isSuspendSafe(rec({ id: "a" })));
  assert.ok(!isSuspendSafe(rec({ id: "b", inFlightPrompt: true })), "idle 但 prompt 未回 → 不安全");
  assert.ok(!isSuspendSafe(rec({ id: "c", pendingApprovals: 1 })), "idle 但有待审批 → 不安全");
  for (const status of ALL_STATUSES) {
    if (status !== "idle") {
      assert.ok(!isSuspendSafe(rec({ id: "d", status })), `${status} 不是 idle → 不安全`);
    }
  }
});

test("正在跑 bash（streaming/queued/waiting_approval/spawning）的对话永远不会被选为休眠对象", () => {
  for (const busy of ["streaming", "queued", "waiting_approval", "spawning"] as ConversationStatus[]) {
    // 忙碌者刻意设为最久未活跃：若按 LRU 裸选就会错杀，必须被跳过
    const picked = pickSuspendCandidate([
      rec({ id: "busy", status: busy, lastActiveAt: 0 }),
      rec({ id: "safe", status: "idle", lastActiveAt: 1000 }),
    ]);
    assert.equal(picked, "safe", `${busy} 中的对话不得入选`);
  }
});

test("LRU 语义：只从可休眠者中挑最久未活跃的那个", () => {
  const picked = pickSuspendCandidate([
    rec({ id: "new", lastActiveAt: 300 }),
    rec({ id: "mid", lastActiveAt: 100 }),
    rec({ id: "old", lastActiveAt: 50 }),
  ]);
  assert.equal(picked, "old");
});

test("用户正在看的 activeId 与被 excludeIds 显式保护的对话永不入选", () => {
  const records = [
    rec({ id: "old", lastActiveAt: 1 }),
    rec({ id: "mid", lastActiveAt: 2 }),
    rec({ id: "new", lastActiveAt: 3 }),
  ];
  assert.equal(pickSuspendCandidate(records, { activeId: "old" }), "mid");
  assert.equal(pickSuspendCandidate(records, { activeId: "old", excludeIds: ["mid"] }), "new");
  assert.equal(pickSuspendCandidate(records, { activeId: "old", excludeIds: ["mid", "new"] }), undefined);
});

test("lastActiveAt 打平时按 id 字典序定序，结果可复现", () => {
  const picked = pickSuspendCandidate([
    rec({ id: "c", lastActiveAt: 9 }),
    rec({ id: "a", lastActiveAt: 9 }),
    rec({ id: "b", lastActiveAt: 9 }),
  ]);
  assert.equal(picked, "a");
  // 换一种输入顺序也必须得到同一答案
  assert.equal(
    pickSuspendCandidate([
      rec({ id: "b", lastActiveAt: 9 }),
      rec({ id: "a", lastActiveAt: 9 }),
    ]),
    "a",
  );
});

test("没有可休眠者时返回 undefined（宁超限拒绝，也不误杀在跑的对话）", () => {
  assert.equal(pickSuspendCandidate([]), undefined);
  assert.equal(
    pickSuspendCandidate([
      rec({ id: "s", status: "streaming" }),
      rec({ id: "q", status: "queued" }),
      rec({ id: "sp", status: "suspended" }),
      rec({ id: "busy", status: "idle", inFlightPrompt: true }),
    ]),
    undefined,
  );
});

test("选人不会改动注册表入参（顺序与内容都不变）", () => {
  const records = [rec({ id: "z", lastActiveAt: 5 }), rec({ id: "a", lastActiveAt: 1 })];
  const before = JSON.stringify(records);
  pickSuspendCandidate(records);
  assert.equal(JSON.stringify(records), before);
});

// ---------- 准入计划（超限不静默杀任务） ----------

test("未占满 MAX_LIVE_ENGINES 时直接 admit", () => {
  const plan = planAdmit([rec({ id: "a", status: "streaming" }), rec({ id: "b", status: "idle" })], 3);
  assert.deepEqual(plan, { action: "admit" });
});

test("满员且存在可休眠者：suspend-first 且点名唯一正确 victim（最旧的安全 idle）", () => {
  const records = [
    rec({ id: "busy", status: "streaming", lastActiveAt: 0 }), // 最久未活跃也不许选
    rec({ id: "older-idle", status: "idle", lastActiveAt: 10 }),
    rec({ id: "newer-idle", status: "idle", lastActiveAt: 20 }),
  ];
  assert.deepEqual(planAdmit(records, 2), { action: "suspend-first", conversationId: "older-idle" });
});

test("suspended/dead 不占引擎名额：不算入 live 计数", () => {
  const records = [rec({ id: "a", status: "idle" }), rec({ id: "b", status: "suspended" }), rec({ id: "c", status: "dead" })];
  assert.deepEqual(planAdmit(records, 1), { action: "suspend-first", conversationId: "a" });
  assert.deepEqual(planAdmit([rec({ id: "b", status: "suspended" }), rec({ id: "c", status: "dead" })], 1), { action: "admit" });
});

test("满员且全在跑：reject 而不是杀任务，原因里必须带上 live 数与上限", () => {
  const records = [
    rec({ id: "a", status: "streaming" }),
    rec({ id: "b", status: "queued" }),
    rec({ id: "c", status: "waiting_approval" }),
  ];
  const plan = planAdmit(records, 2);
  assert.equal(plan.action, "reject");
  if (plan.action === "reject") {
    assert.match(plan.reason, /已有 3 个/);
    assert.match(plan.reason, /上限 2/);
  }
});

test("activeId 即使是最旧的 LRU 候选也绝不成为 victim", () => {
  const records = [
    rec({ id: "active", status: "idle", lastActiveAt: 0 }),
    rec({ id: "other", status: "idle", lastActiveAt: 100 }),
  ];
  assert.deepEqual(planAdmit(records, 2, { activeId: "active" }), { action: "suspend-first", conversationId: "other" });
  // 唯一可休眠者被保护时只能 reject，不得动在跑任务
  assert.equal(planAdmit([rec({ id: "active", status: "idle" })], 1, { activeId: "active" }).action, "reject");
});

test("excludeIds 保护命中唯一候选时同样退化到下一位或 reject", () => {
  const records = [
    rec({ id: "a", status: "idle", lastActiveAt: 0 }),
    rec({ id: "b", status: "idle", lastActiveAt: 1 }),
  ];
  assert.deepEqual(planAdmit(records, 2, { excludeIds: ["a"] }), { action: "suspend-first", conversationId: "b" });
  assert.equal(planAdmit(records, 2, { excludeIds: ["a", "b"] }).action, "reject");
});

test("cap=1 行为合理：空位 admit、有可休眠者 suspend-first、全忙 reject", () => {
  assert.deepEqual(planAdmit([], 1), { action: "admit" });
  assert.deepEqual(planAdmit([rec({ id: "a", status: "idle" })], 1), { action: "suspend-first", conversationId: "a" });
  assert.equal(planAdmit([rec({ id: "a", status: "streaming", inFlightPrompt: true })], 1).action, "reject");
});

// ---------- 并发上限归一化 ----------

test("normalizeMaxLiveEngines 把任意输入夹到 1~4 并截断小数", () => {
  assert.equal(normalizeMaxLiveEngines(1), 1);
  assert.equal(normalizeMaxLiveEngines(4), 4);
  assert.equal(normalizeMaxLiveEngines(0), 1);
  assert.equal(normalizeMaxLiveEngines(-5), 1);
  assert.equal(normalizeMaxLiveEngines(9), 4);
  assert.equal(normalizeMaxLiveEngines(2.9), 2);
  assert.equal(normalizeMaxLiveEngines(-0.5), 1);
  assert.equal(normalizeMaxLiveEngines("3"), 3);
  assert.equal(normalizeMaxLiveEngines("2.7"), 2);
});

test("无法解读的输入回退默认 3（或显式 fallback），且 fallback 自身也先截断再夹取", () => {
  for (const junk of [undefined, NaN, "abc", {}, "x1"]) {
    assert.equal(normalizeMaxLiveEngines(junk), 3, `junk=${String(junk)} 应回退 3`);
    assert.equal(normalizeMaxLiveEngines(junk, 2), 2);
  }
  assert.equal(normalizeMaxLiveEngines(NaN, 3.7), 3);
  assert.equal(normalizeMaxLiveEngines(NaN, 99), 4);
  assert.equal(normalizeMaxLiveEngines(NaN, -1), 1);
});

test("归一化对 null 应回退 fallback 而非把 0 当配置（Number(null)===0 的坑）", () => {
  assert.equal(normalizeMaxLiveEngines(null), 3);
  assert.equal(normalizeMaxLiveEngines(null, 2), 2);
});

test("边界上幂等：归一化一次和归一化两次结果相同", () => {
  for (const v of [0, 1, 2, 4, 5, 4.5, -3, NaN, undefined]) {
    const once = normalizeMaxLiveEngines(v);
    assert.equal(normalizeMaxLiveEngines(once), once);
  }
});

// ---------- 崩溃退避重启 ----------

test("退避重启默认上限 3 次：attempt=restarts+1，延迟 500/1000/2000 指数增长", () => {
  const expected = [500, 1000, 2000];
  for (let restarts = 0; restarts < 3; restarts += 1) {
    const plan = planRestart(restarts);
    assert.deepEqual(plan, { allowed: true, delayMs: expected[restarts], attempt: restarts + 1 });
  }
});

test("重启次数用尽后拒绝自动重启且 delayMs=0（标记 dead 交还用户一键恢复）", () => {
  assert.deepEqual(planRestart(3), { allowed: false, delayMs: 0, attempt: 4 });
  assert.deepEqual(planRestart(7), { allowed: false, delayMs: 0, attempt: 8 });
});

test("指数退避永不越过 capMs 红线", () => {
  for (let restarts = 0; restarts < 8; restarts += 1) {
    const plan = planRestart(restarts, { maxRestarts: 8 });
    assert.ok(plan.delayMs <= 8_000, `attempt ${plan.attempt} 延迟 ${plan.delayMs} 超过 cap`);
    if (restarts >= 1) {
      const prev = planRestart(restarts - 1, { maxRestarts: 8 });
      assert.ok(plan.delayMs >= prev.delayMs, "延迟须单调不减");
    }
  }
  assert.equal(planRestart(5, { maxRestarts: 8 }).delayMs, 8_000); // 500*2^5=16000 被夹到 cap
});

test("maxRestarts/baseMs/capMs 全部可配", () => {
  assert.deepEqual(planRestart(0, { maxRestarts: 1, baseMs: 100, capMs: 1000 }), { allowed: true, delayMs: 100, attempt: 1 });
  assert.deepEqual(planRestart(1, { maxRestarts: 1 }), { allowed: false, delayMs: 0, attempt: 2 });
  assert.deepEqual(planRestart(2, { maxRestarts: 5, baseMs: 1000, capMs: 1500 }), { allowed: true, delayMs: 1500, attempt: 3 });
});

// ---------- 状态集合与恢复 ----------

test("LIVE 与 RESTING 两集合互斥且并集恰好覆盖全部 7 个状态", () => {
  const live = new Set<string>(LIVE_STATUSES);
  const resting = new Set<string>(RESTING_STATUSES);
  for (const s of LIVE_STATUSES) assert.ok(!resting.has(s), `${s} 不能同时 live 又 resting`);
  const union = new Set<string>([...LIVE_STATUSES, ...RESTING_STATUSES]);
  assert.equal(union.size, 7);
  for (const s of ALL_STATUSES) assert.ok(union.has(s), `${s} 未被两集合覆盖`);
  assert.deepEqual([...LIVE_STATUSES].sort(), ["idle", "queued", "spawning", "streaming", "waiting_approval"].sort());
  assert.deepEqual([...RESTING_STATUSES].sort(), ["dead", "suspended"]);
});

test("只有占着引擎进程的 5 个状态计 live；suspended 与 dead 不占名额", () => {
  for (const status of ALL_STATUSES) {
    const expect = status === "spawning" || status === "idle" || status === "streaming" || status === "waiting_approval" || status === "queued";
    assert.equal(isLive({ status }), expect, `isLive(${status})`);
  }
  assert.ok(!isLive({ status: "suspended" }));
  assert.ok(!isLive({ status: "dead" }));
});

test("无进程态才值得走恢复路径：dead 与 suspended 可恢复，活进程不需要恢复", () => {
  assert.ok(canRecover(rec({ id: "a", status: "dead" })));
  assert.ok(canRecover(rec({ id: "b", status: "suspended" })));
  for (const status of LIVE_STATUSES) {
    assert.ok(!canRecover(rec({ id: "c", status })), `isLive(${status}) 不该走恢复`);
  }
});

// ---------- 注册表快照 ----------

test("快照只含文档约定的 6 个字段，pid/lastSeq/restarts 等实现细节不外泄", () => {
  const records = [
    rec({ id: "a", pid: 4321, lastSeq: 9, restarts: 2, sessionFile: "/s.jsonl", worktreePath: "/w" }),
  ];
  const snap = summarizeConversations(records);
  assert.deepEqual(Object.keys(snap[0]).sort(), [
    "droppedEvents",
    "id",
    "lastActiveAt",
    "pendingApprovals",
    "projectDir",
    "status",
  ]);
  assert.equal(snap[0].id, "a");
  assert.ok(!("pid" in snap[0]));
  assert.ok(!("lastSeq" in snap[0]));
});

test("快照保序并如实反映各字段值", () => {
  const records = [
    rec({ id: "z", status: "streaming", lastActiveAt: 7, droppedEvents: 3, pendingApprovals: 1, projectDir: "/z" }),
    rec({ id: "a", status: "suspended", lastActiveAt: 2, droppedEvents: 0, pendingApprovals: 0, projectDir: "/a" }),
  ];
  const snap = summarizeConversations(records);
  assert.deepEqual(snap.map((s) => s.id), ["z", "a"]);
  assert.deepEqual(snap[0], {
    id: "z",
    status: "streaming",
    projectDir: "/z",
    lastActiveAt: 7,
    droppedEvents: 3,
    pendingApprovals: 1,
  });
});

test("快照是投影不是引用：改结果不能污染注册表", () => {
  const records = [rec({ id: "a" }), rec({ id: "b", status: "dead" })];
  const before = JSON.stringify(records);
  const snap = summarizeConversations(records);
  snap[0].status = "spawning";
  snap[0].droppedEvents = 999;
  snap.push({ id: "c", status: "idle", projectDir: "/x", lastActiveAt: 0, droppedEvents: 0, pendingApprovals: 0 });
  delete (snap[1] as Partial<typeof snap[1]>).id;
  assert.equal(JSON.stringify(records), before);
  assert.equal(records.length, 2);
});

test("空注册表快照为空数组", () => {
  assert.deepEqual(summarizeConversations([]), []);
});
