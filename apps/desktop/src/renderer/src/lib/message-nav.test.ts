import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNavTicks, diffBarCounts, firstLine, tickWidthAt, DIFF_TOTAL_BLOCKS, TITLE_MAX_CHARS } from "./message-nav.ts";
import type { ConversationItem } from "../stores/session-store.ts";

/**
 * T9.2 v2.2 消息刻度导航纯函数单测：刻度只按 user 轮次生成 / diffStat 归轮 /
 * 首行摘要清洗与截断 / hover 正态展开（常态等长、无默认高亮）/
 * bars 分档（对齐 OpenWood 参考实现 DiffChanges.blockCounts）。
 */

const user = (id: string, text: string): ConversationItem => ({ id, kind: "user", text });
const assistant = (id: string, text: string): ConversationItem => ({ id, kind: "assistant", text });
const thinking = (id: string, text: string): ConversationItem => ({ id, kind: "thinking", text });
const sys = (id: string, text: string): ConversationItem => ({ id, kind: "system", text, tone: "info" });
const tool = (id: string, diffStat?: { added: number; deleted: number }): ConversationItem => ({
  id,
  kind: "tool",
  toolCallId: id,
  name: "edit",
  args: {},
  status: "ok",
  diffStat,
});

test("firstLine：去 markdown 装饰、压空白、超长截断", () => {
  assert.equal(firstLine("# 标题行\n第二行"), "标题行");
  assert.equal(firstLine("**加粗** 与 `代码`"), "加粗 与 代码");
  assert.equal(firstLine("a    b"), "a b");
  assert.equal(firstLine(""), "");
  const long = firstLine("x".repeat(100));
  assert.equal(long.length, TITLE_MAX_CHARS); // 截到上限：TITLE_MAX_CHARS-1 字符 + 省略号
  assert.ok(long.endsWith("…"));
});

test("buildNavTicks：只有 user 成刻度，序号连续", () => {
  const ticks = buildNavTicks([
    user("u1", "第一个问题"),
    thinking("t1", "想想"),
    assistant("a1", "回答一"),
    user("u2", "第二个问题"),
    assistant("a2", "回答二"),
    sys("s1", "系统提示"),
  ]);
  assert.deepEqual(
    ticks.map((t) => [t.rowId, t.turnIndex, t.title]),
    [
      ["u1", 0, "第一个问题"],
      ["u2", 1, "第二个问题"],
    ],
  );
});

test("buildNavTicks：轮内 tool diffStat 归该轮，跨轮不串", () => {
  const ticks = buildNavTicks([
    tool("orphan", { added: 99, deleted: 99 }), // 首条 user 之前的散工具 → 丢弃
    user("u1", "一"),
    tool("t1", { added: 4, deleted: 1 }),
    assistant("a1", "答"),
    tool("t2", { added: 2, deleted: 0 }),
    user("u2", "二"),
    tool("t3", { added: 0, deleted: 7 }),
  ]);
  assert.deepEqual(
    ticks.map((t) => [t.turnIndex, t.additions, t.deletions]),
    [
      [0, 6, 1],
      [1, 0, 7],
    ],
  );
});

test("diffBarCounts：无改动全中性、极小改动各占一块", () => {
  assert.deepEqual(diffBarCounts(0, 0), [0, 0, 5]);
  assert.deepEqual(diffBarCounts(2, 1), [1, 1, 3]);
  assert.deepEqual(diffBarCounts(4, 0), [1, 0, 4]);
  assert.deepEqual(diffBarCounts(0, 3), [0, 1, 4]);
});

test("diffBarCounts：小幅改动封顶 1~2 块（≤5 行 1 块、≤10 行 2 块）", () => {
  assert.deepEqual(diffBarCounts(5, 5), [1, 1, 3]);
  assert.deepEqual(diffBarCounts(8, 8), [2, 2, 1]);
});

test("diffBarCounts：比例 <4 只上 4 块，剩余走中性", () => {
  assert.deepEqual(diffBarCounts(30, 10), [3, 1, 1]);
  assert.deepEqual(diffBarCounts(60, 20), [3, 1, 1]);
});

test("diffBarCounts：极端比例按主导方回退，总数恒不超 5 块", () => {
  assert.deepEqual(diffBarCounts(100, 1), [4, 1, 0]);
  assert.deepEqual(diffBarCounts(1, 100), [1, 4, 0]);
  for (const [a, d] of [
    [0, 0],
    [1, 1],
    [5, 5],
    [17, 3],
    [1000, 2],
    [3, 900],
  ]) {
    const [add, del, neutral] = diffBarCounts(a, d);
    assert.equal(add + del + neutral, DIFF_TOTAL_BLOCKS, `${a}/${d} 必须铺满 5 块`);
    assert.ok(add >= 0 && del >= 0 && neutral >= 0, `${a}/${d} 不得出现负块`);
  }
});

test("tickWidthAt：常态（未 hover）所有刻度一律等长，不做默认高亮", () => {
  for (let i = 0; i < 8; i += 1) {
    assert.equal(tickWidthAt(i, -1, 16, 30, 1.6), 16, `第 ${i} 根常态必须是 base`);
  }
});

test("tickWidthAt：hover 目标最长，邻居按正态衰减渐次变短", () => {
  const w = (i: number): number => tickWidthAt(i, 3, 16, 30, 1.6);
  assert.equal(w(3), 30); // 目标 = max
  assert.ok(w(2) > w(1) && w(1) > w(0), "距离越远越接近 base");
  assert.ok(w(2) < 30 && w(2) > 16, `邻居必须介于 base 与 max 之间，实际 ${w(2)}`);
  assert.ok(Math.abs(w(2) - w(4)) < 1e-9, "左右对称衰减");
});

test("tickWidthAt：远端回到 base，且全程不越出 [base, max] 带", () => {
  assert.ok(tickWidthAt(20, 0, 16, 30, 1.6) < 16.01, "远端应基本回到 base");
  for (let i = 0; i < 40; i += 1) {
    const width = tickWidthAt(i, 7, 16, 30, 1.6);
    assert.ok(width >= 16 && width <= 30, `第 ${i} 根越界：${width}`);
  }
});
