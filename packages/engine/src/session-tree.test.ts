import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSessionTree, defaultLeaf, flattenTree, pathToLeafIds, type TreeEntry } from "./session-tree.ts";

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

/* ---------- T9.2 pathToLeafIds（transcript 按分支路径过滤的底座） ---------- */

test("pathToLeafIds：线性链返回 root→leaf 全序列", () => {
  const ids = pathToLeafIds([e("a", null, "01"), e("b", "a", "02"), e("c", "b", "03")], "c");
  assert.deepEqual(ids, ["a", "b", "c"]);
});

test("pathToLeafIds：分叉树只取选中叶的祖先链，不含旁支", () => {
  const entries = [
    e("root", null, "01"),
    e("u1", "root", "02"),
    e("main", "u1", "03"),
    e("main2", "main", "04"),
    e("branch", "u1", "05"),
  ];
  assert.deepEqual(pathToLeafIds(entries, "branch"), ["root", "u1", "branch"]);
  assert.deepEqual(pathToLeafIds(entries, "main2"), ["root", "u1", "main", "main2"]);
});

test("pathToLeafIds：leaf 不存在返回 null（调用方降级为不过滤）", () => {
  assert.equal(pathToLeafIds([e("a", null, "01")], "nope"), null);
});

test("pathToLeafIds：parentId 成环不死循环，回到已访问即截断", () => {
  const cyclic = [e("x", "y", "01"), e("y", "x", "02")];
  const ids = pathToLeafIds(cyclic, "x");
  assert.deepEqual(ids, ["y", "x"]);
});
