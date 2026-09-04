import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ConversationEventEnvelopeSchema,
  EngineEventSchema,
  makeEngineEnvelope,
  routeForConversation,
  unwrapEnginePayload,
} from "./engine.ts";

/**
 * T8.2 契约纯函数单测：envelope 的构造/归一/路由。
 * 重点不是「能解析」，而是**退化与丢弃必须可见**——丢事件不许静默是 §7.9 的硬验收项。
 */

test("合法 envelope 归一出事件本体与归属", () => {
  const env = makeEngineEnvelope("conv-1", "/proj/a", { type: "agent_start" }, { seq: 7, active: true });
  const out = unwrapEnginePayload(env);
  assert.equal(out.legacy, false);
  assert.equal(out.event?.type, "agent_start");
  assert.equal(out.envelope?.conversationId, "conv-1");
  assert.equal(out.envelope?.seq, 7);
  assert.equal(out.envelope?.active, true);
});

test("旧版裸事件按 legacy 放行（未升级的推送路径退化成旧行为，而不是丢事件）", () => {
  const out = unwrapEnginePayload({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hi" } });
  assert.equal(out.legacy, true);
  assert.equal(out.envelope, null);
  assert.equal(out.event?.type, "message_update");
});

test("有 event 字段但信封不合法 → 判丢弃并给原因，绝不降级当裸事件", () => {
  for (const bad of [
    { event: { type: "agent_start" } }, // 缺 conversationId/projectDir
    { conversationId: "", projectDir: "/p", event: { type: "agent_start" } }, // 空 id
    { conversationId: "c", projectDir: "/p", event: { nope: true } }, // 事件本体非法
  ]) {
    const out = unwrapEnginePayload(bad);
    assert.equal(out.event, null, `应判丢弃：${JSON.stringify(bad)}`);
    assert.ok(out.reason, "丢弃必须带原因（渲染层据此计数 + warn）");
    assert.equal(out.legacy, false);
  }
});

test("非对象载荷不崩，只判丢弃", () => {
  for (const raw of [null, undefined, 42, "str", []]) {
    const out = unwrapEnginePayload(raw);
    assert.equal(out.event, null);
    assert.equal(out.envelope, null);
  }
});

test("宿主自造事件（user_message / model_changed）也是合法载荷", () => {
  // 回归：这两条曾被漏在 EngineEventSchema 外，envelope 严格校验会把它们判成非法
  for (const ev of [
    { type: "user_message", text: "压测消息 #1" },
    { type: "model_changed", provider: "deepseek", id: "deepseek-chat" },
    { type: "thinking_level_changed", thinkingLevel: "high" },
  ]) {
    assert.ok(EngineEventSchema.safeParse(ev).success, `${ev.type} 应在事件契约内`);
    assert.equal(unwrapEnginePayload(makeEngineEnvelope("c", "/p", ev)).event?.type, ev.type);
  }
});

test("seq/active 是可选项，缺省不污染信封", () => {
  const env = ConversationEventEnvelopeSchema.parse(makeEngineEnvelope("c", "/p", { type: "agent_end" }));
  assert.equal("seq" in env, false);
  assert.equal("active" in env, false);
});

test("路由：active 一律照收；非 active 且已选定对话才判别家", () => {
  const mine = makeEngineEnvelope("conv-a", "/p", { type: "agent_start" }, { active: true });
  const other = makeEngineEnvelope("conv-b", "/p", { type: "agent_start" }, { active: false });
  assert.equal(routeForConversation(mine, "conv-a"), "apply");
  assert.equal(routeForConversation(other, "conv-a"), "foreign");
  // 尚未选定对话（首帧前）/ 裸事件（无归属）→ 不退化成丢事件
  assert.equal(routeForConversation(other, null), "apply");
  assert.equal(routeForConversation(null, "conv-a"), "apply");
  // active 标记优先：压测钩子等合成推送不能被误判
  assert.equal(routeForConversation(makeEngineEnvelope("stress", "", { type: "user_message" }, { active: true }), "conv-a"), "apply");
});
