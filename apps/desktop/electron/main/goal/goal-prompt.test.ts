import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuditPrompt, buildContinuationPrompt, buildKickoffPrompt, parseAudit } from "./goal-prompt.ts";
import { newGoalState } from "./goal-machine.ts";

test("parseAudit：纯 JSON", () => {
  assert.deepEqual(parseAudit('{"verdict":"complete","note":"done"}'), { verdict: "complete", note: "done" });
});

test("parseAudit：代码围栏 / 前后夹杂文本仍提取", () => {
  assert.equal(parseAudit('```json\n{"verdict":"blocked","note":"nope"}\n```')?.verdict, "blocked");
  assert.equal(parseAudit('结果如下 {"verdict":"continue"} 供参考')?.verdict, "continue");
});

test("parseAudit：非法 verdict / 缺字段 / 非 JSON → undefined（审计失败）", () => {
  assert.equal(parseAudit('{"verdict":"maybe"}'), undefined);
  assert.equal(parseAudit('{"note":"没有verdict"}'), undefined);
  assert.equal(parseAudit("no json here"), undefined);
  assert.equal(parseAudit(""), undefined);
  assert.equal(parseAudit('{"verdict": broken}'), undefined);
});

test("buildAuditPrompt：含目标正文与最近回复、要求 JSON", () => {
  const p = buildAuditPrompt("在 README 加一行 ZZZ", "已经加好了");
  assert.match(p, /在 README 加一行 ZZZ/);
  assert.match(p, /已经加好了/);
  assert.match(p, /verdict/);
});

test("buildContinuationPrompt：带剩余预算/轮次与报告要求", () => {
  const s = newGoalState("x", 10, 20, 1000);
  s.turnsUsed = 5;
  s.tokensUsed = 300;
  const p = buildContinuationPrompt("目标Y", s);
  assert.match(p, /目标Y/);
  assert.match(p, /剩余约 700 tokens/);
  assert.match(p, /15 轮/);
  assert.match(p, /REMAINING:/);
});

test("buildKickoffPrompt：包裹目标", () => {
  assert.match(buildKickoffPrompt("做个事"), /目标模式/);
  assert.match(buildKickoffPrompt("做个事"), /做个事/);
});
