import { test } from "node:test";
import assert from "node:assert/strict";
import { collapseTurnProcess, groupToolRows, isToolGroup, isTurnProcess, type DisplayRow } from "./tool-groups.ts";
import type { ConversationItem } from "../stores/session-store";

const tool = (id: string, over: Partial<Extract<ConversationItem, { kind: "tool" }>> = {}): ConversationItem => ({
  id,
  kind: "tool",
  toolCallId: id,
  name: "bash",
  args: { command: "ls" },
  status: "ok",
  ...over,
});
const text = (id: string, kind: "user" | "assistant"): ConversationItem => ({ id, kind, text: "hi" });

test("关闭分组时原样返回同一数组", () => {
  const items = [text("u1", "user"), tool("t1"), tool("t2")];
  assert.equal(groupToolRows(items, false), items);
});

test("单个工具（前后有文本）不被误分组", () => {
  const rows = groupToolRows([text("u1", "user"), tool("t1"), text("a1", "assistant")], true);
  assert.deepEqual(rows.map((r) => r.kind), ["user", "tool", "assistant"]);
  assert.equal(isToolGroup(rows[1]), false);
});

test("连续多个工具归为一组并聚合状态/计数/耗时", () => {
  const items = [tool("t1", { durationMs: 100 }), tool("t2", { durationMs: 250 }), tool("t3")];
  const rows = groupToolRows(items, true);
  assert.equal(rows.length, 1);
  assert.ok(isToolGroup(rows[0]));
  const g = rows[0] as Extract<DisplayRow, { kind: "tool_group" }>;
  assert.equal(g.id, "tg:t1"); // 首工具 id → 稳定键
  assert.equal(g.tools.length, 3);
  assert.equal(g.status, "all_ok");
  assert.equal(g.okCount, 3);
  assert.equal(g.totalDurationMs, 350); // t3 无耗时不计入
});

test("无任一耗时 → totalDurationMs 为 undefined", () => {
  const rows = groupToolRows([tool("t1"), tool("t2")], true);
  assert.ok(isToolGroup(rows[0]));
  assert.equal((rows[0] as { totalDurationMs?: number }).totalDurationMs, undefined);
});

test("组内 running → 状态 running；含 error → has_error", () => {
  const running = groupToolRows([tool("t1", { status: "running" }), tool("t2")], true)[0];
  assert.ok(isToolGroup(running) && running.status === "running");
  const errored = groupToolRows([tool("t1", { status: "error" }), tool("t2")], true)[0];
  assert.ok(isToolGroup(errored) && errored.status === "has_error" && errored.errorCount === 1);
});

test("多段连续工具被文本分隔为多组", () => {
  const items = [
    tool("a1"), tool("a2"), tool("a3"),
    text("m", "assistant"),
    tool("b1"), tool("b2"),
  ];
  const rows = groupToolRows(items, true);
  assert.deepEqual(rows.map((r) => r.kind), ["tool_group", "assistant", "tool_group"]);
  assert.equal((rows[0] as { tools: unknown[] }).tools.length, 3);
  assert.equal((rows[2] as { tools: unknown[] }).tools.length, 2);
});

test("system/thinking 打断连续性", () => {
  const items: ConversationItem[] = [tool("t1"), { id: "th", kind: "thinking", text: "…" }, tool("t2")];
  const rows = groupToolRows(items, true);
  assert.deepEqual(rows.map((r) => r.kind), ["tool", "thinking", "tool"]);
});

/* ------------------------- T10 轮次过程折叠 ------------------------- */

const thinking = (id: string, durationMs?: number): ConversationItem => ({ id, kind: "thinking", text: "…", durationMs });
const sys = (id: string): ConversationItem => ({ id, kind: "system", text: "note", tone: "info" });
const kinds = (rows: DisplayRow[]): string[] => rows.map((r) => r.kind);
const segments = (rows: DisplayRow[]): (DisplayRow[] | undefined)[] =>
  rows.map((r) => (isTurnProcess(r) ? r.rows : undefined));

test("collapseTurnProcess：空输入返回空数组", () => {
  assert.deepEqual(collapseTurnProcess([], false), []);
});

test("collapseTurnProcess：流式中的最后一轮保持展开（过程要边跑边看）", () => {
  const rows = groupToolRows([text("u1", "user"), thinking("th1"), tool("t1"), text("a1", "assistant")], true);
  assert.deepEqual(kinds(collapseTurnProcess(rows, true)), ["user", "thinking", "tool", "assistant"]);
});

test("collapseTurnProcess：轮次结束后过程收成一行，正文留在折叠体之外", () => {
  const items: ConversationItem[] = [
    text("u1", "user"),
    thinking("th1", 300),
    tool("t1", { durationMs: 100 }),
    tool("t2", { durationMs: 250 }),
    text("a1", "assistant"),
  ];
  const out = collapseTurnProcess(groupToolRows(items, true), false);
  assert.deepEqual(kinds(out), ["user", "turn_process", "assistant"]);
  assert.ok(isTurnProcess(out[1]));
  const tp = out[1];
  assert.equal(tp.id, "tp:th1"); // 过程首行 id → 稳定键
  assert.equal(tp.thinkingCount, 1);
  assert.equal(tp.toolCount, 2); // 工具组内的工具按条计数，不是按组计
  assert.equal(tp.errorCount, 0);
  assert.equal(tp.durationMs, 650); // 300 + 100 + 250
  // 展开体按原顺序还原：思考 → 工具组（t1/t2 已合组）
  assert.deepEqual(segments(out)[1]?.map((r) => r.kind), ["thinking", "tool_group"]);
});

test("collapseTurnProcess：多轮各自折叠，每轮正文都保留", () => {
  const items: ConversationItem[] = [
    text("u1", "user"), thinking("th1"), tool("t1"), text("a1", "assistant"),
    text("u2", "user"), tool("t2"), tool("t3"), text("a2", "assistant"),
  ];
  const out = collapseTurnProcess(groupToolRows(items, true), false);
  assert.deepEqual(kinds(out), ["user", "turn_process", "assistant", "user", "turn_process", "assistant"]);
});

test("collapseTurnProcess：组内仍有 running 工具时不折叠", () => {
  const rows = groupToolRows([text("u1", "user"), tool("t1", { status: "running" }), text("a1", "assistant")], true);
  assert.deepEqual(kinds(collapseTurnProcess(rows, false)), ["user", "tool", "assistant"]);
});

test("collapseTurnProcess：该轮没有正文时不折叠（折叠会把内容藏没）", () => {
  const rows = groupToolRows([text("u1", "user"), thinking("th1"), tool("t1"), tool("t2")], true);
  assert.deepEqual(kinds(collapseTurnProcess(rows, false)), ["user", "thinking", "tool_group"]);
});

test("collapseTurnProcess：整轮只有一条正文时不产生折叠行", () => {
  const rows = groupToolRows([text("u1", "user"), text("a1", "assistant")], true);
  assert.deepEqual(kinds(collapseTurnProcess(rows, false)), ["user", "assistant"]);
});

test("collapseTurnProcess：正文之后的 system 行留在折叠体之外", () => {
  const items: ConversationItem[] = [
    text("u1", "user"), thinking("th1"), tool("t1"), text("a1", "assistant"), sys("s1"),
  ];
  const out = collapseTurnProcess(groupToolRows(items, true), false);
  assert.deepEqual(kinds(out), ["user", "turn_process", "assistant", "system"]);
});
