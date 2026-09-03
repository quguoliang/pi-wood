import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReviewPrompt, hasChanges, parseFindings } from "./parse-findings.ts";

test("hasChanges：空白/空 diff → false，有内容 → true", () => {
  assert.equal(hasChanges(""), false);
  assert.equal(hasChanges("   \n  "), false);
  assert.equal(hasChanges("diff --git a/x b/x"), true);
});

test("parseFindings：纯 JSON 数组、字段规整", () => {
  const f = parseFindings('[{"file":"a.ts","line":12,"severity":"error","message":"空指针","suggestion":"加判空"}]');
  assert.deepEqual(f, [{ file: "a.ts", line: 12, severity: "error", message: "空指针", suggestion: "加判空" }]);
});

test("parseFindings：代码围栏 / 前后夹杂文本仍能提取", () => {
  assert.equal(parseFindings('```json\n[{"file":"b","severity":"warning","message":"m"}]\n```').length, 1);
  assert.equal(parseFindings('发现如下：\n[{"file":"b","severity":"info","message":"m"}]\n以上').length, 1);
});

test("parseFindings：非法项丢弃（缺 file/message、未知 severity→info、负/缺 line→省略）", () => {
  const f = parseFindings('[{"message":"无文件"}, {"file":"c","severity":"weird","message":"x","line":-3}, {"file":"d","message":"ok"}]');
  assert.deepEqual(f, [
    { file: "c", line: undefined, severity: "info", message: "x", suggestion: undefined },
    { file: "d", line: undefined, severity: "info", message: "ok", suggestion: undefined },
  ]);
});

test("parseFindings：空数组 / 非数组 / 无 JSON / 坏 JSON → []", () => {
  assert.deepEqual(parseFindings("[]"), []);
  assert.deepEqual(parseFindings('{"file":"x"}'), []);
  assert.deepEqual(parseFindings("没有数组"), []);
  assert.deepEqual(parseFindings("[{坏 json]"), []);
  assert.deepEqual(parseFindings(""), []);
});

test("buildReviewPrompt：含 diff、要求 JSON 数组、severity 枚举", () => {
  const p = buildReviewPrompt("diff --git a/x b/x");
  assert.match(p, /diff --git a\/x b\/x/);
  assert.match(p, /JSON 数组/);
  assert.match(p, /"error"\|"warning"\|"info"/);
});

test("buildReviewPrompt：超大 diff 截断", () => {
  const p = buildReviewPrompt("x".repeat(100_000));
  assert.ok(p.length < 100_000);
  assert.match(p, /diff 过大已截断/);
});
