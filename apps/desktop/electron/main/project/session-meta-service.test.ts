/**
 * session-meta-service 单元测试（T8.11 验收）
 * 风格对齐 conversation-core.test.ts：平铺 test + 中文标题，标题写「保证」。
 * 覆盖：patch 合并语义（清键不留垃圾）+ 注册表落盘持久化 + 独立实例可读回。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, after } from "node:test";
import { SessionMetaStore, applySessionMetaPatch } from "./session-meta-service.ts";

const dir = mkdtempSync(join(tmpdir(), "pi-wood-session-meta-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("applySessionMetaPatch：归档/取消归档只动 archived 位，别的字段保留", () => {
  const current = { pinned: true, alias: "修复登录页" };
  const next = applySessionMetaPatch(current, { archived: true });
  assert.deepEqual(next, { pinned: true, alias: "修复登录页", archived: true });
  const restored = applySessionMetaPatch(next, { archived: false });
  assert.deepEqual(restored, { pinned: true, alias: "修复登录页" });
});

test("applySessionMetaPatch：forkedFrom 谱系写入/空串删键/单独存在不算空（T9.2 v2.1）", () => {
  const withFork = applySessionMetaPatch({ alias: "Fork of 甲" }, { forkedFrom: "/tmp/a.jsonl" });
  assert.deepEqual(withFork, { alias: "Fork of 甲", forkedFrom: "/tmp/a.jsonl" });
  const onlyFork = applySessionMetaPatch(undefined, { forkedFrom: "/tmp/b.jsonl" });
  assert.deepEqual(onlyFork, { forkedFrom: "/tmp/b.jsonl" }, "只有 forkedFrom 的条目不能被全空清理误删");
  const cleared = applySessionMetaPatch(onlyFork, { forkedFrom: "  " });
  assert.equal(cleared, undefined, "空串=删键；删完全空整条回收");
});

test("applySessionMetaPatch：空别名视作清除，不落空白串", () => {
  const next = applySessionMetaPatch({ alias: "  修复登录页  " }, { alias: "   " });
  assert.equal(next?.alias, undefined);
  assert.equal(next?.pinned, undefined);
});

test("applySessionMetaPatch：patch 合并而非整体替换（只传 pinned 不丢 alias）", () => {
  const next = applySessionMetaPatch({ alias: "名字" }, { pinned: true });
  assert.deepEqual(next, { alias: "名字", pinned: true });
});

test("applySessionMetaPatch：全空条目返回 undefined（调用方据此删键，注册表不积垃圾）", () => {
  assert.equal(applySessionMetaPatch({ archived: true }, { archived: false }), undefined);
  assert.equal(applySessionMetaPatch(undefined, {}), undefined);
});

test("SessionMetaStore：set 后可读回，重启（新实例）后仍可读——落盘持久化", () => {
  const store = new SessionMetaStore(dir);
  const file = join(dir, "sessions", "a.jsonl");
  const result = store.set(file, { archived: true, alias: "调研" });
  assert.deepEqual(result, { archived: true, alias: "调研" });
  const reopened = new SessionMetaStore(dir);
  assert.deepEqual(reopened.get(file), { archived: true, alias: "调研" });
  assert.equal(Object.keys(reopened.list()).length, 1);
});

test("SessionMetaStore：clear 删键；损坏/缺失文件按空表处理不抛", () => {
  const store = new SessionMetaStore(dir);
  const file = join(dir, "sessions", "b.jsonl");
  store.set(file, { pinned: true });
  store.clear(file);
  assert.equal(store.get(file), undefined);
  const broken = new SessionMetaStore(join(dir, "not-exist"));
  assert.deepEqual(broken.list(), {});
  assert.equal(broken.get("x"), undefined);
});

test("applySessionMetaPatch：messages 按 entryId 合并——新增不覆盖既有，单条删除留其余", () => {
  const base = applySessionMetaPatch(undefined, {
    messages: { e1: { attachments: [{ path: "/a.png", name: "a.png", size: 1, kind: "image" }] } },
  });
  assert.ok(base?.messages?.e1);
  const merged = applySessionMetaPatch(base, {
    messages: { e2: { snippets: [{ path: "x.ts", name: "x.ts", start: 1, end: 2, snippet: "s" }] } },
  });
  assert.ok(merged?.messages?.e1, "二次 patch 不得丢掉 e1");
  assert.ok(merged?.messages?.e2);
  const pruned = applySessionMetaPatch(merged, { messages: { e1: undefined as never } });
  assert.equal(pruned?.messages?.e1, undefined);
  assert.ok(pruned?.messages?.e2);
});

test("SessionMetaStore：messages 元数据落盘后可读回（重启后历史气泡仍有附件）", () => {
  const store = new SessionMetaStore(dir);
  const file = join(dir, "s.jsonl");
  const meta = { attachments: [{ path: "/p/i.png", name: "i.png", size: 3, kind: "image", thumb: "data:image/jpeg;base64,t" }] };
  store.set(file, { messages: { e9: meta } });
  const back = new SessionMetaStore(dir).get(file);
  assert.deepEqual(back?.messages?.e9, meta);
});
