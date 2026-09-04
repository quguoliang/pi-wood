import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COALESCABLE_EVENT_TYPES,
  coalesceKey,
  createOutboundThrottle,
  eventBytes,
  mergeCoalescable,
} from "./engine-throttle.ts";

/**
 * T8.3 出站节流单测——性能红线「事件流量」那一行的机制判据。
 * 真机三路并发的条数由 `--conversation-probe` 复算，这里保证机制本身确定、可回归。
 */

const delta = (text: string, kind: "text_delta" | "thinking_delta" = "text_delta", messageId = "msg-1") => ({
  type: "message_update",
  messageId,
  assistantMessageEvent: { type: kind, delta: text },
});

const milestone = (type = "tool_execution_start") => ({ type, toolCallId: "t1", toolName: "bash", args: {} });

test("可见对话完全旁路：逐 token 原样透传（体感优先）", () => {
  const t = createOutboundThrottle();
  let frames = 0;
  for (let i = 0; i < 500; i++) frames += t.push(delta("啊"), true).length;
  assert.equal(frames, 500, "active 对话一条都不能被合掉，否则前台打字机卡顿");
  assert.equal(t.stats().pending, 0);
});

test("后台对话：1000 个 token 在 1s 内压到 ≤6 帧，且文本一字不丢", () => {
  const t = createOutboundThrottle({ maxWaitMs: 200, maxBytes: 1_000_000 });
  let out = 0;
  let joined = "";
  for (let i = 0; i < 1000; i++) {
    const frames = t.push(delta(`${i} `), false);
    out += frames.length;
    for (const f of frames) joined += String((f.event.assistantMessageEvent as { delta?: string }).delta ?? "");
  }
  for (const f of [...t.tick(), ...t.tick(), ...t.tick(), ...t.tick(), ...t.tick(), ...t.flush()]) {
    out += 1;
    joined += String((f.event.assistantMessageEvent as { delta?: string }).delta ?? "");
  }
  assert.ok(out <= 6, `200ms 窗口 1s 内最多 5 帧 + 首帧，实际 ${out}`);
  assert.equal(joined.startsWith("0 1 2 3 4 5 6 7 8 9 10 "), true, "合并必须保持顺序与内容");
  assert.ok(joined.endsWith("999 "), "尾巴不许被吞");
  assert.equal(t.stats().pending, 0);
});

test("里程碑：先按原顺序冲缓冲再直发（顺序不变量），绝不把 token 留在里程碑之后", () => {
  const t = createOutboundThrottle();
  t.push(delta("前半段"), false); // 先进缓冲
  const frames = t.push(milestone(), false);
  assert.equal(frames.length, 2, "缓冲里的 token 必须跟着里程碑一起出，否则渲染层顺序错乱");
  assert.equal((frames[0].event.assistantMessageEvent as { delta?: string }).delta, "前半段");
  assert.equal(frames[1].event.type, "tool_execution_start");
  assert.equal(t.stats().pending, 0);
});

test("合并键：text/thinking 不互合、不同工具不互合、边界事件不合", () => {
  assert.equal(coalesceKey(delta("a")), "mu:msg-1:text_delta");
  assert.equal(coalesceKey(delta("a", "thinking_delta")), "mu:msg-1:thinking_delta");
  assert.equal(coalesceKey(delta("a", "text_delta", "msg-2")), "mu:msg-2:text_delta");
  assert.equal(coalesceKey({ type: "message_update", assistantMessageEvent: { type: "text_end" } }), null);
  assert.equal(coalesceKey({ type: "tool_execution_update", toolCallId: "a" }), "teu:a");
  assert.equal(coalesceKey({ type: "tool_execution_update", toolCallId: "b" }), "teu:b");
  assert.equal(coalesceKey({ type: "agent_settled" }), null);
  assert.ok(COALESCABLE_EVENT_TYPES.includes("bash_execution_update"));
});

test("mergeCoalescable：delta 拼接；累计型载荷取最新；键不同拒合", () => {
  const merged = mergeCoalescable(delta("你好"), delta("世界"));
  assert.equal((merged?.assistantMessageEvent as { delta: string }).delta, "你好世界");
  const tool = mergeCoalescable(
    { type: "tool_execution_update", toolCallId: "a", partialResult: "1" },
    { type: "tool_execution_update", toolCallId: "a", partialResult: "12" },
  );
  assert.equal(tool?.partialResult, "12", "partialResult 是累计语义，取最新而不是拼接");
  assert.equal(mergeCoalescable(delta("a"), delta("b", "thinking_delta")), null);
  assert.equal(mergeCoalescable(milestone(), milestone()), null);
});

test("字节阈值到点提前出帧（长输出不该干等 200ms）", () => {
  const t = createOutboundThrottle({ maxWaitMs: 10_000, maxBytes: 50 });
  let out = 0;
  for (let i = 0; i < 20; i++) out += t.push(delta("0123456789"), false).length;
  assert.ok(out >= 2, `每 ~10 字节就该凑满 50 阈值出帧，实际 ${out}`);
});

test("flush 不吞帧且幂等；stats 自洽（in = 已发出 + 在途，merged 记被合掉的条数）", () => {
  const t = createOutboundThrottle();
  let out = 0;
  for (let i = 0; i < 30; i++) out += t.push(delta("x"), false).length;
  const flushed = t.flush();
  out += flushed.length;
  const s = t.stats();
  assert.equal(s.in, 30);
  assert.equal(s.pending, 0);
  assert.equal(s.out, out);
  assert.equal(s.in - s.out, s.merged, "少发出去的帧数必须等于被合掉的条数（不许凭空蒸发）");
  assert.deepEqual(t.flush(), [], "flush 幂等");
});

test("eventBytes 对不可序列化对象不抛（循环引用退化成字符串长度）", () => {
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic.self = cyclic;
  assert.ok(eventBytes(cyclic) > 0);
  assert.ok(Number.isFinite(eventBytes(undefined)));
});
