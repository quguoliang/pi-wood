import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEngineEvent,
  applyEvents,
  emptySlice,
  flushLive,
  mergeHistory,
  statPatch,
  type ConversationSlice,
} from "./conversation-slice.ts";

/**
 * T8.3 归约纯函数穷举（`node --test`，不需要 electron / 不需要真引擎）。
 * 每条用例都对应 §7.9 T8.3 的一个验收点或一条不变量，不写「函数能跑」这种废测试。
 */

const ctx = (over: { now?: number; visible?: boolean; seq?: number; epoch?: number; prefix?: string } = {}) => ({
  now: over.now ?? 1000,
  nextId: (() => {
    let n = 0;
    const p = over.prefix ?? "m";
    return () => `${p}${++n}`;
  })(),
  visible: over.visible,
  seq: over.seq,
  epoch: over.epoch,
});

const apply = (slice: ConversationSlice, e: Record<string, unknown>, c = ctx()) => applyEngineEvent(slice, e, c).slice;
const kinds = (s: ConversationSlice) => s.items.map((i) => i.kind).join(",");

test("纯：归约不修改入参切片（返回新对象，原对象字段不变）", () => {
  const before = emptySlice();
  const snapshot = JSON.stringify(before);
  const after = apply(before, { type: "agent_start" });
  assert.notEqual(after, before);
  assert.equal(JSON.stringify(before), snapshot, "入参必须原封不动");
});

test("不变量：后台对话的 token 只进自己的切片，前台尾巴不被污染", () => {
  let a = emptySlice();
  let b = emptySlice();
  a = apply(a, { type: "message_update", assistantMessageEvent: { type: "text_start" } });
  a = apply(a, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "前台在跑" } });
  b = apply(b, { type: "message_update", assistantMessageEvent: { type: "text_start" } });
  b = apply(b, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "后台在跑" } });
  assert.equal(a.liveText, "前台在跑");
  assert.equal(b.liveText, "后台在跑");
  assert.equal(a.streaming, false, "A 的 streaming 不受 B 影响");
});

test("交错事件流：两路各自跑完一整轮，条数与顺序互不干扰", () => {
  const script = (who: string) => [
    { type: "agent_start" },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: `${who}1` } },
    { type: "tool_execution_start", toolCallId: `${who}-t1`, toolName: "read", args: { path: "a" } },
    { type: "tool_execution_end", toolCallId: `${who}-t1`, result: { content: [{ type: "text", text: "ok" }] } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: `${who}2` } },
    { type: "agent_settled" },
  ];
  let a = emptySlice();
  let b = emptySlice();
  for (const e of script("A")) a = apply(a, e, ctx({ prefix: "a" }));
  for (const e of script("B")) b = apply(b, e, ctx({ prefix: "b" }));
  assert.equal(kinds(a), "assistant,tool,assistant", `实际 ${kinds(a)}（工具前必须 flush 尾巴，保证顺序）`);
  assert.equal(kinds(b), "assistant,tool,assistant");
  assert.equal(a.items.filter((i) => i.kind === "assistant").map((i) => (i as { text: string }).text).join("|"), "A1|A2");
  assert.equal(b.items.filter((i) => i.kind === "assistant").map((i) => (i as { text: string }).text).join("|"), "B1|B2");
  assert.equal(a.streaming, false);
  assert.equal(a.toolCallCount, 1);
  assert.equal(a.runningToolCount, 0);
});

test("工具生命周期：running→update→end 落状态并算出耗时", () => {
  let s = emptySlice();
  s = apply(s, { type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "ls" } }, ctx({ now: 100 }));
  const tool = s.items[0];
  assert.equal(tool?.kind, "tool");
  assert.equal((tool as { status: string }).status, "running");
  assert.equal(s.runningToolCount, 1);
  s = apply(s, { type: "tool_execution_update", toolCallId: "t1", partialResult: { content: [{ type: "text", text: "半程" }] } }, ctx({ now: 150 }));
  assert.equal((s.items[0] as { output?: string }).output, "半程");
  s = apply(s, { type: "tool_execution_end", toolCallId: "t1", result: { content: [{ type: "text", text: "done" }] } }, ctx({ now: 180 }));
  assert.equal((s.items[0] as { status: string }).status, "ok");
  assert.equal((s.items[0] as { durationMs?: number }).durationMs, 80);
  assert.equal(s.runningToolCount, 0);
});

test("未知 toolCallId 的 update/end 不新建条目、也不改动状态", () => {
  const start = apply(emptySlice(), { type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: {} });
  const r = applyEngineEvent(start, { type: "tool_execution_end", toolCallId: "nope", result: {} }, ctx());
  assert.equal(r.changed, false, "对不上号的回执必须整条忽略，不许凭空造条目");
  assert.equal(r.slice, start);
});

test("edit 的 patch 统计出 +/- 行数（右栏与内联 diff 依赖它）", () => {
  assert.deepEqual(statPatch("--- a\n+++ b\n+x\n+y\n-z\n context"), { added: 2, deleted: 1 });
});

test("unread 只数里程碑：token 不计数，工具/回合/审批计数", () => {
  let s = emptySlice();
  const hidden = ctx({ visible: false });
  s = applyEngineEvent(s, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x" } }, hidden).slice;
  s = applyEngineEvent(s, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "y" } }, hidden).slice;
  assert.equal(s.unreadCount, 0, "逐 token 增量不该算未读，否则切过去清零毫无意义");
  s = applyEngineEvent(s, { type: "agent_start" }, hidden).slice;
  s = applyEngineEvent(s, { type: "tool_execution_start", toolCallId: "t", toolName: "bash", args: {} }, hidden).slice;
  s = applyEngineEvent(s, { type: "approval_request", request: {} }, hidden).slice;
  assert.equal(s.unreadCount, 3);
  assert.equal(s.hasPendingApproval, true);
  assert.equal(s.runningToolCount, 1);
});

test("visible 时不累计 unread（前台看见的不算未读）", () => {
  let s = emptySlice();
  s = applyEngineEvent(s, { type: "agent_start" }, ctx({ visible: true })).slice;
  s = applyEngineEvent(s, { type: "tool_execution_start", toolCallId: "t", toolName: "bash", args: {} }, ctx({ visible: true })).slice;
  assert.equal(s.unreadCount, 0);
});

test("seq 对账：倒退/重复帧丢弃，断号计入 droppedEvents", () => {
  let s = emptySlice();
  s = applyEngineEvent(s, { type: "agent_start" }, ctx({ seq: 1 })).slice;
  assert.equal(s.lastSeq, 1);
  const dup = applyEngineEvent(s, { type: "tool_execution_start", toolCallId: "t", toolName: "x", args: {} }, ctx({ seq: 1 }));
  assert.equal(dup.changed, false, "重复帧不得二次入账");
  assert.equal(dup.slice, s);
  const jumped = applyEngineEvent(s, { type: "agent_settled" }, ctx({ seq: 5 }));
  assert.equal(jumped.slice.droppedEvents, 3, "5-1-1 = 3 条缺号");
  assert.equal(jumped.slice.lastSeq, 5);
});

test("epoch 变了 = child 重生：seq 基线重置，新流不再被旧 lastSeq 静默丢弃（⑤）", () => {
  let s = emptySlice();
  s = applyEngineEvent(s, { type: "user_message", text: "旧轮" }, ctx({ seq: 1, epoch: 1 })).slice;
  s = applyEngineEvent(s, { type: "agent_settled" }, ctx({ seq: 2, epoch: 1 })).slice;
  assert.equal(s.lastSeq, 2);
  assert.equal(s.epoch, 1);
  // child 重启后 upSeq 从 0 重计：同样的 seq 若没有 epoch 重置会被全部丢掉
  s = applyEngineEvent(s, { type: "agent_start" }, ctx({ seq: 1, epoch: 2 })).slice;
  assert.equal(s.epoch, 2, "基线随新世代重置");
  assert.equal(s.lastSeq, 1);
  assert.equal(s.streaming, true, "新流事件必须照常生效");
  assert.equal(s.droppedEvents, 0, "世代切换不计断号");
  // 同世代内倒退帧照旧丢弃
  const stale = applyEngineEvent(s, { type: "agent_settled" }, ctx({ seq: 1, epoch: 2 }));
  assert.equal(stale.changed, false);
  // 无 epoch 戳的旧路径不触发重置（行为不变）
  const noEpoch = applyEngineEvent(s, { type: "agent_settled" }, ctx({ seq: 9 }));
  assert.equal(noEpoch.slice.droppedEvents, 7, "9-1-1 = 7（旧行为不变）");
});

test("里程碑摘要供后台标签显示（工具名 + 结果）", () => {
  let s = emptySlice();
  s = apply(s, { type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: {} });
  s = apply(s, { type: "tool_execution_end", toolCallId: "t1", result: { content: [{ type: "text", text: "ok" }] } });
  assert.equal(s.lastMilestone, "bash 完成");
});

test("turn_end 的中断标记落成 system 条目（与 T5.x 文案一致）", () => {
  const s = apply(emptySlice(), { type: "turn_end", message: { stopReason: "aborted" } });
  assert.equal(kinds(s), "system");
  assert.equal((s.items[0] as { text: string }).text, "对话已终止");
  const clean = applyEngineEvent(emptySlice(), { type: "turn_end", message: { stopReason: "end_turn" } }, ctx());
  assert.equal(clean.slice.items.length, 0, "正常收尾不该造条目");
});

test("compaction / auto_retry / queue_update 都有对应可见状态", () => {
  let s = apply(emptySlice(), { type: "compaction_start" });
  assert.equal((s.items[0] as { text: string }).text, "正在压缩上下文…");
  s = apply(s, { type: "compaction_end", aborted: true });
  assert.equal((s.items[s.items.length - 1] as { text: string }).text, "上下文压缩已中止");
  s = apply(s, { type: "auto_retry_start", attempt: 2, maxAttempts: 5 });
  assert.match((s.items[s.items.length - 1] as { text: string }).text, /第 2\/5 次/);
  s = apply(s, { type: "auto_retry_end", success: false, finalError: "429" });
  assert.match((s.items[s.items.length - 1] as { text: string }).text, /429/);
  s = apply(s, { type: "queue_update", steering: ["a"], followUp: ["b", "c"] });
  assert.deepEqual(s.queue, { steering: ["a"], followUp: ["b", "c"] });
  s = apply(s, { type: "agent_settled" });
  assert.deepEqual(s.queue, { steering: [], followUp: [] }, "回合结束清空排队");
});

test("thinking 块落条目时带时长（起点记在切片内，不再是模块级变量）", () => {
  let s = apply(emptySlice(), { type: "message_update", assistantMessageEvent: { type: "thinking_start" } }, ctx({ now: 100 }));
  s = apply(s, { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "想想" } }, ctx({ now: 120 }));
  s = apply(s, { type: "message_update", assistantMessageEvent: { type: "thinking_end" } }, ctx({ now: 180 }));
  const item = s.items[0] as { kind: string; text: string; durationMs?: number };
  assert.equal(item.kind, "thinking");
  assert.equal(item.durationMs, 80);
});

test("flushLive 幂等：尾巴为空时不产条目也不报错", () => {
  const base = emptySlice();
  const f1 = flushLive(base, ctx());
  assert.equal(f1.flushed, false);
  assert.equal(f1.slice, base, "无变化时必须返回同一引用（让上层跳过 set）");
  const withLive: ConversationSlice = { ...base, liveText: "x" };
  const f2 = flushLive(withLive, ctx());
  assert.equal(f2.slice.items.length, 1);
  assert.equal(f2.slice.liveText, "");
});

test("历史对账：与已收增量重复的条目不双份，缺的前置补上", () => {
  let s = emptySlice();
  s = apply(s, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "新尾巴" } });
  s = apply(s, { type: "agent_settled" }); // 落地成一条 assistant「新尾巴」
  const { slice, deduped } = mergeHistory(s, [
    { role: "user", text: "老问题" },
    { role: "assistant", text: "新尾巴" }, // 与已收增量重复
    { role: "tool", text: "结果", toolCallId: "t1", toolName: "read" },
  ], ctx({ prefix: "h" }));
  assert.equal(deduped, 1);
  assert.equal(kinds(slice), "user,tool,assistant", "历史缺的补在前、已收增量保持在后");
  assert.equal(slice.historyLoaded, true);
  assert.equal(slice.items.filter((i) => (i as { text?: string }).text === "新尾巴").length, 1, "不得双份");
});

test("未知事件类型与缺 type 不崩、也不改状态", () => {
  for (const e of [{}, { type: "future_event" }, { type: 123 }, { type: "message_update" }] as Array<Record<string, unknown>>) {
    const r = applyEngineEvent(emptySlice(), e, ctx());
    assert.equal(r.changed, false);
  }
});

test("applyEvents 批量灌入按顺序生效（测试与回放增量共用）", () => {
  const s = applyEvents(emptySlice(), [
    { type: "user_message", text: "问题" },
    { type: "agent_start" },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "答" } },
    { type: "agent_settled" },
  ], { idPrefix: "x" });
  assert.equal(kinds(s), "user,assistant");
  assert.equal(s.streaming, false);
});

test("user_message 透传附件/引用元数据：气泡在发送后仍能展示芯片", () => {
  const attachments = [{ path: "/tmp/a.png", name: "a.png", size: 10, kind: "image" as const, thumb: "data:image/png;base64,x" }];
  const snippets = [{ path: "src/app.ts", name: "app.ts", start: 1, end: 3, snippet: "code" }];
  const s = apply(emptySlice(), { type: "user_message", text: "看这个", attachments, snippets });
  const item = s.items[0];
  assert.equal(item?.kind, "user");
  if (item?.kind !== "user") return;
  assert.deepEqual(item.attachments, attachments);
  assert.deepEqual(item.snippets, snippets);
});

test("历史回填：HistoryMessageItem 的附件/引用落到 user 条目（切对话/重启后气泡不丢芯片）", () => {
  const attachments = [{ path: "/tmp/b.png", name: "b.png", size: 20, kind: "image" as const }];
  const { slice } = mergeHistory(emptySlice(), [
    { role: "user", text: "带图的问题", entryId: "e1", attachments },
    { role: "assistant", text: "答" },
  ], ctx({ prefix: "h" }));
  const user = slice.items.find((i) => i.kind === "user");
  assert.ok(user && user.kind === "user");
  if (user?.kind !== "user") return;
  assert.deepEqual(user.attachments, attachments);
  assert.equal(user.snippets, undefined, "没有引用时不挂空数组");
});

test("warming：user_message 点亮冷启动扫光，agent_start/agent_settled 接力清掉", () => {
  let s = apply(emptySlice(), { type: "user_message", text: "问题" });
  assert.equal((s as { warming?: boolean }).warming, true, "发送后、agent_start 前 = warming");
  s = apply(s, { type: "agent_start" });
  assert.equal((s as { warming?: boolean }).warming, false, "首帧事件到达即交给流式 UI");
  assert.equal(s.streaming, true);
  s = apply(s, { type: "agent_settled" });
  assert.equal((s as { warming?: boolean }).warming, false);
});

test("warming：turn_end 与 mergeHistory 兜底清零（错误/终止不留永久扫光）", () => {
  let s = apply(emptySlice(), { type: "user_message", text: "问题" });
  s = apply(s, { type: "turn_end", message: { stopReason: "aborted" } });
  assert.equal((s as { warming?: boolean }).warming, false);
  const { slice } = mergeHistory(apply(emptySlice(), { type: "user_message", text: "x" }), [
    { role: "user", text: "x" },
  ], ctx({ prefix: "h" }));
  assert.equal((slice as { warming?: boolean }).warming, false);
});
