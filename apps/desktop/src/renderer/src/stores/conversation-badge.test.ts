import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { badgeFor, tabTitle } from "./conversation-badge.ts";

describe("badgeFor（状态→徽章，优先级穷举）", () => {
  it("待审批红点优先于一切", () => {
    assert.equal(badgeFor("waiting_approval", { pendingApprovals: 1, inFlightPrompt: true, unread: 3 }), "approval");
    assert.equal(badgeFor("streaming", { pendingApprovals: 2, inFlightPrompt: true, unread: 0 }), "approval");
  });
  it("在飞转圈次之；排队/启动中/关停各归其位", () => {
    assert.equal(badgeFor("streaming", { pendingApprovals: 0, inFlightPrompt: false, unread: 9 }), "streaming");
    assert.equal(badgeFor("idle", { pendingApprovals: 0, inFlightPrompt: true, unread: 9 }), "streaming");
    assert.equal(badgeFor("queued", { pendingApprovals: 0, inFlightPrompt: false, unread: 0 }), "queued");
    assert.equal(badgeFor("spawning", { pendingApprovals: 0, inFlightPrompt: false, unread: 0 }), "spawning");
    assert.equal(badgeFor("suspended", { pendingApprovals: 0, inFlightPrompt: false, unread: 5 }), "resting");
    assert.equal(badgeFor("dead", { pendingApprovals: 0, inFlightPrompt: false, unread: 0 }), "resting");
  });
  it("无状态信号但有未读 → 蓝点；全无 → none", () => {
    assert.equal(badgeFor("idle", { pendingApprovals: 0, inFlightPrompt: false, unread: 2 }), "unread");
    assert.equal(badgeFor("idle", { pendingApprovals: 0, inFlightPrompt: false, unread: 0 }), "none");
  });
});

describe("tabTitle（标签标题）", () => {
  it("首条用户消息优先并截断", () => {
    assert.equal(tabTitle("帮我修个 bug", "/repo/proj", "conv-3-abc"), "帮我修个 bug");
    const long = "这句话特别长特别长特别长特别长特别长特别长特别长特别长";
    assert.equal(tabTitle(long, "/repo/proj", "conv-3-abc"), `${long.slice(0, 24)}…`);
  });
  it("缺省回落「项目名 · 对话 N」", () => {
    assert.equal(tabTitle(undefined, "/repo/proj", "conv-3-abc12345"), "proj · 对话 3");
    assert.equal(tabTitle("   ", "C:\\repo\\proj", "conv-11-xyz"), "proj · 对话 11");
  });
});
