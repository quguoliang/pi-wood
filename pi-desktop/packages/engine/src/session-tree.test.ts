import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSessionTree, defaultLeaf, flattenTree, type TreeEntry } from "./session-tree.ts";

const e = (id: string, parentId: string | null, ts: string, type = "message"): TreeEntry => ({
  type,
  id,
  parentId,
  timestamp: ts,
});

test("线性会话：单根单链", () => {
  const tree = buildSessionTree([e("a", null, "01"), e("b", "a", "02"), e("c", "b", "03")]);
  assert.equal(tree.roots.length, 1);
  assert.equal(tree.roots[0].id, "a");
  assert.equal(tree.leafCandidates.length, 1);
  assert.equal(tree.leafCandidates[0].id, "c");
  const rows = flattenTree(tree, "c");
  assert.deepEqual(
    rows.map((r) => r.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    rows.map((r) => r.depth),
    [0, 1, 2],
  );
  assert.ok(rows.every((r) => r.activeBranch));
});

test("分支会话：两个兄弟分支 → 两个末梢，活跃路径正确标记", () => {
  const tree = buildSessionTree([
    e("root", null, "01"),
    e("l1", "root", "02"),
    e("l2", "l1", "03"),
    e("r1", "root", "04"),
  ]);
  assert.equal(tree.roots.length, 1);
  assert.equal(tree.leafCandidates.length, 2);
  assert.equal(defaultLeaf(tree)?.id, "r1");

  // 活跃叶 = l2（左分支），r1 不在活跃路径
  const rows = flattenTree(tree, "l2");
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.ok(byId.get("root")?.activeBranch);
  assert.ok(byId.get("l1")?.activeBranch);
  assert.ok(byId.get("l2")?.activeBranch);
  assert.ok(!byId.get("r1")?.activeBranch);
});

test("孤儿条目不丢失：parentId 缺失时挂为独立根", () => {
  const tree = buildSessionTree([e("a", null, "01"), e("ghost-child", "missing", "02")]);
  assert.equal(tree.roots.length, 1);
  assert.equal(tree.orphans.length, 1);
  assert.equal(flattenTree(tree).length, 2);
});

test("同父子节点按时间戳排序，畸形条目跳过", () => {
  const tree = buildSessionTree([
    e("p", null, "05"),
    e("late", "p", "09"),
    e("early", "p", "06"),
    { type: "bad" as unknown as string, id: "", parentId: null, timestamp: "07" } as unknown as TreeEntry,
  ]);
  assert.deepEqual(
    tree.nodes.get("p")?.children.map((c) => c.id),
    ["early", "late"],
  );
  assert.equal(tree.nodes.size, 3);
});
