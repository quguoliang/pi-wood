import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addItem,
  deleteById,
  parseItems,
  renderForAgent,
  serializeItems,
  setReviewed,
  updateItem,
  type MemoryItem,
} from "./store.ts";

const item = (over: Partial<MemoryItem>): MemoryItem => ({
  id: "m1",
  type: "fact",
  title: "T",
  body: "B",
  scope: "global",
  createdAt: 1,
  reviewed: false,
  ...over,
});

test("parse/serialize 往返 + 坏输入降级 []", () => {
  const items = [item({})];
  assert.deepEqual(parseItems(serializeItems(items)), items);
  assert.deepEqual(parseItems(""), []);
  assert.deepEqual(parseItems("not json"), []);
  assert.deepEqual(parseItems('{"not":"array"}'), []);
  assert.deepEqual(parseItems('[{"id":"x"}]'), []); // 缺 title/body 丢
});

test("parseItems 归一非法 type/scope、reviewed 严格 === true", () => {
  const got = parseItems('[{"id":"a","title":"t","body":"b","type":"weird","scope":"nope","reviewed":"yes"}]');
  assert.equal(got[0]?.type, "fact");
  assert.equal(got[0]?.scope, "global");
  assert.equal(got[0]?.reviewed, false);
});

test("addItem 新增：reviewed:false、默认 type=fact、scope 归一", () => {
  const r = addItem([], { title: "偏好", body: "用 pnpm" }, { id: "id1", now: 10 });
  assert.equal(r.created, true);
  assert.equal(r.item?.reviewed, false);
  assert.equal(r.item?.type, "fact");
  assert.equal(r.item?.scope, "global");
  assert.equal(r.items.length, 1);
});

test("addItem 校验：缺 title 或 body → error、items 不变", () => {
  const base: MemoryItem[] = [];
  assert.ok(addItem(base, { title: "", body: "x" }).error);
  assert.ok(addItem(base, { title: "t", body: "  " }).error);
});

test("addItem upsert：同 scope+标题(忽略大小写)更新 body、reviewed 重置 false、不新增", () => {
  let { items, item: first } = addItem([], { title: "Key", body: "v1", scope: "project" }, { id: "k1", now: 1 });
  assert.ok(first);
  items = setReviewed(items, "k1", true).items;
  assert.equal(items[0]?.reviewed, true);
  const r = addItem(items, { title: "key", body: "v2", scope: "project" }, { now: 2 });
  assert.equal(r.created, false);
  assert.equal(r.items.length, 1); // 没有第二条
  assert.equal(r.item?.body, "v2");
  assert.equal(r.item?.reviewed, false); // 内容变了 → 重新待确认
  assert.equal(r.item?.createdAt, 1); // 保留原创建时间
});

test("addItem 内容未变时不重置 reviewed", () => {
  const { items } = addItem([], { title: "T", body: "B" }, { id: "z", now: 1 });
  const reviewed = setReviewed(items, "z", true).items;
  const r = addItem(reviewed, { title: "T", body: "B" }, { now: 2 });
  assert.equal(r.item?.reviewed, true);
});

test("deleteById / setReviewed 命中与未命中", () => {
  const base = [item({ id: "a" }), item({ id: "b" })];
  assert.equal(deleteById(base, "a").removed, true);
  assert.equal(deleteById(base, "a").items.length, 1);
  assert.equal(deleteById(base, "zz").removed, false);
  assert.equal(setReviewed(base, "b", true).changed, true);
  assert.equal(setReviewed(setReviewed(base, "b", true).items, "b", true).changed, false);
});

test("updateItem：未找到→error；改内容→reviewed 重置", () => {
  assert.ok(updateItem([], "x", { body: "y" }).error);
  const base = [item({ id: "a", reviewed: true, body: "old" })];
  const r = updateItem(base, "a", { body: "new" });
  assert.equal(r.item?.reviewed, false);
  assert.equal(r.items.length, 1);
});

test("renderForAgent：含 id、区分两段、未确认标注", () => {
  const s = renderForAgent([item({ id: "g1", title: "全局偏好", reviewed: false })], [item({ id: "p1", title: "项目规则", reviewed: true, scope: "project" })]);
  assert.match(s, /\[g1\]/);
  assert.match(s, /未确认/);
  assert.match(s, /【全局记忆】/);
  assert.match(s, /【本项目记忆】/);
  assert.match(s, /p1/);
});
