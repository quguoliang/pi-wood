import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeEngineEvent } from "./event-bridge.ts";

test("合法事件原样通过并保留未知字段", () => {
  const out = normalizeEngineEvent({
    type: "tool_execution_start",
    toolCallId: "t1",
    toolName: "edit",
    someFutureField: { a: 1 },
  });
  assert.equal(out.type, "tool_execution_start");
  assert.equal(
    (out as { toolName?: string }).toolName,
    "edit",
  );
  assert.ok("someFutureField" in out);
});

test("未知事件类型归一化为 unknown，不抛出", () => {
  const warns: string[] = [];
  const out = normalizeEngineEvent({ type: "future_event_v2", data: 1 }, (m) => warns.push(m));
  assert.equal(out.type, "unknown");
  assert.equal((out as { originalType: string }).originalType, "future_event_v2");
  assert.equal(warns.length, 1);
});

test("非对象/缺 type 的事件不崩溃", () => {
  assert.equal(normalizeEngineEvent(null).type, "unknown");
  assert.equal(normalizeEngineEvent("oops").type, "unknown");
  assert.equal(normalizeEngineEvent({ noType: true }).type, "unknown");
  assert.equal(
    (normalizeEngineEvent({ noType: true }) as { originalType: string }).originalType,
    "non-object-event",
  );
});

test("已知类型但载荷畸形 → 仍归一化为 unknown（载荷收紧前的预期行为）", () => {
  const out = normalizeEngineEvent({ type: "tool_execution_start", toolCallId: 123 });
  // toolCallId 必须为 string，畸形载荷走 unknown 兜底而非静默通过
  assert.equal(out.type, "unknown");
});
