import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContextOutline, LIVE_NODE_ID, type OutlineNode } from "./context-outline.ts";
import { groupToolRows } from "./tool-groups.ts";
import type { ConversationItem } from "../stores/session-store.ts";

/**
 * T9.1 上下文缩略树纯函数单测：user 分节 / 工具归组 / 序号 / 截断 / 边界。
 */

const user = (id: string, text: string): ConversationItem => ({ id, kind: "user", text });
const assistant = (id: string, text: string): ConversationItem => ({ id, kind: "assistant", text });
const thinking = (id: string, text: string): ConversationItem => ({ id, kind: "thinking", text });
const tool = (id: string, name: string, status: "running" | "ok" | "error" = "ok"): ConversationItem => ({
  id,
  kind: "tool",
  toolCallId: id,
  name,
  args: {},
  status,
});
const sys = (id: string, text: string, tone: "info" | "warn" | "error" | "success" = "info"): ConversationItem => ({
  id,
  kind: "system",
  text,
  tone,
});

test("基本分节：user 主节点 + 工具归 children + assistant/thinking 不进树", () => {
  const rows: ConversationItem[] = [
    user("u1", "帮我读一下 README"),
    tool("t1", "read"),
    assistant("a1", "读完了，内容是…"),
    thinking("th1", "思考…"),
    user("u2", "再改一下"),
    tool("t2", "edit"),
  ];
  const out = buildContextOutline(rows);
  assert.equal(out.length, 2);
  const [n1, n2] = out as OutlineNode[];
  assert.equal(n1.kind, "user");
  assert.equal(n1.no, 1);
  assert.equal(n1.title, "帮我读一下 README");
  assert.deepEqual(n1.children.map((c) => c.id), ["t1"]);
  assert.equal(n2.no, 2);
  assert.deepEqual(n2.children.map((c) => c.id), ["t2"]);
});

test("连续工具经 groupToolRows 成组后标题为「名 ×n」且状态聚合", () => {
  const items: ConversationItem[] = [
    user("u1", "跑测试"),
    tool("t1", "bash", "ok"),
    tool("t2", "bash", "error"),
    assistant("a0", "中间隔一条回复打断连续段"), // 打断连续性：否则三个工具归成一组
    tool("t3", "read", "running"),
  ];
  const out = buildContextOutline(groupToolRows(items, true));
  const n1 = out[0] as OutlineNode;
  assert.equal(n1.children.length, 2); // bash×2 成组 + read 单个
  const g = n1.children[0];
  assert.equal(g.title, "bash ×2");
  assert.equal(g.status, "error");
  assert.equal(g.id.startsWith("tg:"), true);
  assert.equal(n1.children[1].title, "read");
  assert.equal(n1.children[1].status, "running");
});

test("分组关闭时工具逐条进 children，状态直传", () => {
  const items: ConversationItem[] = [user("u1", "q"), tool("t1", "read", "ok"), tool("t2", "edit", "error")];
  const out = buildContextOutline(groupToolRows(items, false));
  const n1 = out[0] as OutlineNode;
  assert.equal(n1.children.length, 2);
  assert.deepEqual(n1.children.map((c) => c.status), ["ok", "error"]);
});

test("标题取首行、折叠空白、超 48 字截断加省略号", () => {
  const long = `${"#"} ${"很".repeat(60)}\n第二行`;
  const out = buildContextOutline([user("u1", long)]);
  const n1 = out[0] as OutlineNode;
  assert.equal(n1.title.length, 48);
  assert.ok(n1.title.endsWith("…"));
  assert.ok(!n1.title.includes("\n"));
  assert.ok(!n1.title.startsWith("#"));
});

test("空文本 user 标题回落「(空消息)」；空输入返回空数组", () => {
  const out = buildContextOutline([user("u1", "   \n  ")]);
  assert.equal((out[0] as OutlineNode).title, "(空消息)");
  assert.deepEqual(buildContextOutline([]), []);
});

test("system 行成独立标记节点且带 tone；其后工具不归属上一 user", () => {
  const items: ConversationItem[] = [
    user("u1", "q1"),
    sys("s1", "已压缩历史", "warn"),
    tool("t1", "read"),
    user("u2", "q2"),
  ];
  const out = buildContextOutline(items);
  assert.equal(out.length, 3);
  const s = out[1] as OutlineNode;
  assert.equal(s.kind, "system");
  assert.equal(s.tone, "warn");
  assert.equal(s.children.length, 0);
});

test("首个 user 之前的散工具被丢弃（无处归属）", () => {
  const items: ConversationItem[] = [tool("t0", "read"), user("u1", "q")];
  const out = buildContextOutline(items);
  assert.equal(out.length, 1);
  assert.equal((out[0] as OutlineNode).children.length, 0);
});

test("streaming 时末尾追加 live 伪节点；非 streaming 不加", () => {
  assert.equal(buildContextOutline([user("u1", "q")], { streaming: true }).at(-1)?.kind, "live");
  assert.equal(LIVE_NODE_ID, "__live__");
  assert.equal(buildContextOutline([user("u1", "q")]).some((e) => e.kind === "live"), false);
});
