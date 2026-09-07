import assert from "node:assert/strict";
import { test } from "node:test";
import {
  branchTitle,
  defaultLeafId,
  deriveContextTree,
  expandBranch,
  navigateLandsOn,
  type TreeRowLike,
} from "./context-tree.ts";

/** 造行：id/parent/role/textHead，depth 不参与派生（渲染层只用拓扑） */
const row = (id: string, parentId: string | null, role: TreeRowLike["role"], textHead?: string, timestamp = id): TreeRowLike => ({
  id,
  parentId,
  type: "message",
  depth: 0,
  activeBranch: false,
  timestamp: `2026-09-0${1 + (Number(timestamp.charCodeAt(0)) % 6)}T00:00:0${timestamp.charCodeAt(1) % 10}.000Z`.replace("t", "T"),
  role,
  textHead,
});

test("deriveContextTree：线性会话无旁支、路径=全量、forked=false", () => {
  const rows = [row("u1", null, "user", "第一个问题"), row("a1", "u1", "assistant", "回答"), row("u2", "a1", "user", "追问"), row("a2", "u2", "assistant", "再答")];
  const t = deriveContextTree(rows, "a2");
  assert.deepEqual(t.pathIds, ["u1", "a1", "u2", "a2"]);
  assert.deepEqual(t.pathUserEntryIds, ["u1", "u2"]);
  assert.equal(t.branches.length, 0);
  assert.equal(t.forked, false);
  assert.equal(t.leafId, "a2");
});

test("deriveContextTree：分叉会话——旁支折叠成一条、挂在正确序号下", () => {
  const rows = [
    row("u1", null, "user", "问题一"),
    row("a1", "u1", "assistant", "答复一"),
    // 主路
    row("u2", "a1", "user", "问题二"),
    row("a2", "u2", "assistant", "答复二"),
    // 旁支（从 a1 处分出，含两轮 user）
    row("u2b", "a1", "user", "换个思路"),
    row("a2b", "u2b", "assistant", "另一答"),
    row("u3b", "a2b", "user", "继续旁支"),
  ];
  const t = deriveContextTree(rows, "a2");
  assert.equal(t.branches.length, 1, "整棵旁支折叠成一条");
  const b = t.branches[0];
  assert.equal(b.rootId, "u2b");
  assert.equal(b.attachOrdinal, 1, "a1 之前有 1 条路径 user（u1）");
  assert.equal(b.userCount, 2);
  assert.equal(b.totalEntries, 3);
  assert.equal(b.title, "换个思路");
  assert.equal(t.forked, true);
});

test("deriveContextTree：切到旁支叶后，原主路变旁支", () => {
  const rows = [
    row("u1", null, "user", "问题一"),
    row("a1", "u1", "assistant", "答复一"),
    row("u2", "a1", "user", "主路问题"),
    row("u2b", "a1", "user", "旁支问题"),
  ];
  const t = deriveContextTree(rows, "u2b");
  assert.deepEqual(t.pathIds, ["u1", "a1", "u2b"]);
  assert.equal(t.branches.length, 1);
  assert.equal(t.branches[0].rootId, "u2");
  assert.equal(t.branches[0].attachOrdinal, 1);
});

test("deriveContextTree：无 user 且非 assistant 起头的碎枝旁支隐藏；assistant 起头的保留", () => {
  const rows = [
    row("u1", null, "user", "问题"),
    row("a1", "u1", "assistant", "答"),
    row("t-orphan", "u1", "tool", "bash"),
    row("a-alt", "u1", "assistant"),
  ];
  const t = deriveContextTree(rows, "a1");
  assert.deepEqual(
    t.branches.map((b) => b.rootId),
    ["a-alt"],
    "纯工具旁支隐藏；无题面 assistant 旁支保留（可「从这里继续聊」）",
  );
  assert.equal(t.branches[0].title, "（回复）");
});

test("deriveContextTree：孤儿/多根条目挂 0 号位", () => {
  const rows = [
    row("u1", null, "user", "主问题"),
    row("a1", "u1", "assistant", "答"),
    row("x1", "missing", "user", "孤儿提问"),
  ];
  const t = deriveContextTree(rows, "a1");
  assert.equal(t.branches.length, 1);
  assert.equal(t.branches[0].rootId, "x1");
  assert.equal(t.branches[0].attachOrdinal, 0);
});

test("deriveContextTree：activeLeafId 无效时回落默认叶；parentId 成环不死循环", () => {
  const rows = [row("u1", null, "user", "甲"), row("a1", "u1", "assistant", "乙")];
  assert.equal(deriveContextTree(rows, "nope").leafId, "a1");
  const cyclic = [row("x", "y", "user", "环x"), row("y", "x", "assistant", "环y")];
  const t = deriveContextTree(cyclic, "y");
  assert.ok(Array.isArray(t.pathIds) && t.pathIds.length <= 2, "环上回溯有界终止");
});

test("defaultLeafId：取时间戳最新的末梢", () => {
  const rows: TreeRowLike[] = [
    { ...row("old-leaf", null, "user", "旧"), timestamp: "2026-01-01T00:00:00.000Z" },
    { ...row("new-leaf", null, "user", "新"), timestamp: "2026-09-01T00:00:00.000Z" },
    { ...row("mid-child", "old-leaf", "user", "子"), timestamp: "2026-05-01T00:00:00.000Z" },
  ];
  assert.equal(defaultLeafId(rows), "new-leaf");
});

test("expandBranch：按 DFS 列出分支内 user 节点并受 limit 约束", () => {
  const rows = [
    row("u1", null, "user", "根问题"),
    row("b1", "u1", "user", "旁支一轮"),
    row("c1", "b1", "assistant", "答"),
    row("b2", "c1", "user", "旁支二轮"),
    row("b3", "b1", "user", "旁支另一轮"),
  ];
  const all = expandBranch(rows, "b1");
  assert.deepEqual(all.map((n) => n.entryId), ["b1", "b3", "b2"], "同层按时间戳（这里=id）升序、深度优先");
  assert.equal(all[1].hops, 1);
  assert.equal(expandBranch(rows, "b1", 2).length, 2);
});

test("navigateLandsOn：user 落其父并回填；其余落自身；未知目标 null", () => {
  const rows = [row("u1", null, "user", "问"), row("a1", "u1", "assistant", "答"), row("u2", "a1", "user", "追问")];
  assert.deepEqual(navigateLandsOn(rows, "u2"), { leafId: "a1", prefill: true });
  assert.deepEqual(navigateLandsOn(rows, "a1"), { leafId: "a1", prefill: false });
  assert.equal(navigateLandsOn(rows, "ghost"), null);
});

test("branchTitle：截 48 省略号；空题面按角色占位", () => {
  assert.equal(branchTitle(row("x", null, "user", "  多行\n第二行被丢弃  ")), "多行");
  assert.equal(branchTitle(row("x", null, "user", "一".repeat(60))), `${"一".repeat(47)}…`);
  assert.equal(branchTitle(row("x", null, "assistant", undefined)), "（回复）");
});
