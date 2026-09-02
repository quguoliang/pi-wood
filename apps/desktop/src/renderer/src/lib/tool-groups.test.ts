import { test } from "node:test";
import assert from "node:assert/strict";
import { groupToolRows, isToolGroup, type DisplayRow } from "./tool-groups.ts";
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
