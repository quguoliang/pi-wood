import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getOutlineAnchor,
  publishOutlineAnchor,
  resetOutlineAnchorForTest,
  subscribeOutlineAnchor,
} from "./outline-bus.ts";

/**
 * T9.2 v2.2 阅读锚点总线单测：晚订阅回放当前值（兄弟 effect 顺序坑）/ 同值去重 / 退订后不再收。
 */

test("订阅即刻回放当前锚点，晚挂载消费者不会错过首帧", () => {
  resetOutlineAnchorForTest();
  publishOutlineAnchor("row-u1");
  const seen: Array<string | undefined> = [];
  const off = subscribeOutlineAnchor((id) => seen.push(id));
  assert.deepEqual(seen, ["row-u1"]);

  publishOutlineAnchor("row-u2");
  assert.deepEqual(seen, ["row-u1", "row-u2"]);
  assert.equal(getOutlineAnchor(), "row-u2");
  off();
});

test("同值发布去重，退订后不再收到更新", () => {
  resetOutlineAnchorForTest();
  const seen: Array<string | undefined> = [];
  const off = subscribeOutlineAnchor((id) => seen.push(id));
  assert.deepEqual(seen, [undefined]);

  publishOutlineAnchor("row-a");
  publishOutlineAnchor("row-a");
  assert.deepEqual(seen, [undefined, "row-a"]);

  off();
  publishOutlineAnchor("row-b");
  assert.deepEqual(seen, [undefined, "row-a"]);
  assert.equal(getOutlineAnchor(), "row-b");
});

test("多订阅者各自独立，全部退订后发布不报错", () => {
  resetOutlineAnchorForTest();
  let a = 0;
  let b = 0;
  const offA = subscribeOutlineAnchor(() => { a += 1; });
  const offB = subscribeOutlineAnchor(() => { b += 1; });
  publishOutlineAnchor("row-x");
  assert.deepEqual([a, b], [2, 2]); // 初值回放 + 一次变更
  offA();
  offB();
  publishOutlineAnchor("row-y");
  assert.deepEqual([a, b], [2, 2]);
});
