import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptAllScope,
  canRespond,
  checkApprovalTicket,
  groupOrderByConversation,
  pendingKey,
  shouldArmTimeout,
} from "./approval-ownership.ts";

describe("pendingKey", () => {
  it("对话归属 key = conversationId:seq", () => {
    assert.equal(pendingKey("conv-1-abcd", 7), "conv-1-abcd:7");
  });
  it("无归属（插件等全局请求）落 global 桶", () => {
    assert.equal(pendingKey(undefined, 3), "global:3");
    assert.equal(pendingKey(null, 3), "global:3");
  });
  it("同 seq 不同对话不冲突", () => {
    assert.notEqual(pendingKey("conv-a", 1), pendingKey("conv-b", 1));
  });
});

describe("canRespond（应答者必须是发起对话）", () => {
  it("应答者 = 发起对话 → 放行", () => {
    assert.equal(canRespond("conv-a", "conv-a"), true);
  });
  it("跨对话应答 → 拒绝（安全旁路）", () => {
    assert.equal(canRespond("conv-a", "conv-b"), false);
  });
  it("应答者缺省（不知道自己在替谁应答）→ 拒绝", () => {
    assert.equal(canRespond("conv-a", undefined), false);
    assert.equal(canRespond("conv-a", null), false);
    assert.equal(canRespond("conv-a", ""), false);
  });
  it("全局请求（owner 空）任何对话均可应答", () => {
    assert.equal(canRespond(undefined, "conv-a"), true);
    assert.equal(canRespond(null, undefined), true);
    assert.equal(canRespond(undefined, undefined), true);
  });
});

describe("shouldArmTimeout（超时按可见性分档）", () => {
  it("发起对话是 active → 正常起 120s 表", () => {
    assert.equal(shouldArmTimeout("conv-a", "conv-a"), true);
  });
  it("后台对话的 pending 不计时（不能被 120s 静默判死）", () => {
    assert.equal(shouldArmTimeout("conv-b", "conv-a"), false);
    assert.equal(shouldArmTimeout("conv-b", undefined), false);
  });
  it("全局请求维持原语义：起表", () => {
    assert.equal(shouldArmTimeout(undefined, "conv-a"), true);
    assert.equal(shouldArmTimeout(null, undefined), true);
  });
});

describe("checkApprovalTicket（一次性票据防重放）", () => {
  it("首次消费 → ok", () => {
    const seen = new Set<string>();
    assert.deepEqual(checkApprovalTicket(seen, "t-1"), { ok: true });
  });
  it("同一票据二次使用 → 拒绝（重放）", () => {
    const seen = new Set<string>(["t-1"]);
    const r = checkApprovalTicket(seen, "t-1");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /重放|已消费/);
  });
  it("票据缺省或非字符串 → 拒绝", () => {
    assert.equal(checkApprovalTicket(new Set(), undefined).ok, false);
    assert.equal(checkApprovalTicket(new Set(), "").ok, false);
    assert.equal(checkApprovalTicket(new Set(), 42).ok, false);
  });
});

describe("acceptAllScope（只放行该对话的 pending）", () => {
  const entries = [
    { key: "conv-a:1", conversationId: "conv-a" },
    { key: "conv-a:2", conversationId: "conv-a" },
    { key: "conv-b:3", conversationId: "conv-b" },
    { key: "global:4", conversationId: null },
  ];
  it("active 对话的 pending 全部命中，别对话与全局项不动", () => {
    assert.deepEqual(acceptAllScope(entries, "conv-a").map((e) => e.key), ["conv-a:1", "conv-a:2"]);
  });
  it("换一个 active 只命中那个对话", () => {
    assert.deepEqual(acceptAllScope(entries, "conv-b").map((e) => e.key), ["conv-b:3"]);
  });
  it("无 active（引擎未起）→ 不放行任何项", () => {
    assert.deepEqual(acceptAllScope(entries, undefined), []);
  });
});

describe("groupOrderByConversation（PromptTray 按对话分组展示）", () => {
  it("同对话相邻，组间按首达顺序", () => {
    const items = [
      { conversationId: "conv-b", tag: "b1" },
      { conversationId: "conv-a", tag: "a1" },
      { conversationId: "conv-b", tag: "b2" },
      { conversationId: null, tag: "g1" },
      { conversationId: "conv-a", tag: "a2" },
    ];
    assert.deepEqual(groupOrderByConversation(items).map((i) => i.tag), ["b1", "b2", "a1", "a2", "g1"]);
  });
  it("空队列 → 空", () => {
    assert.deepEqual(groupOrderByConversation([]), []);
  });
});
