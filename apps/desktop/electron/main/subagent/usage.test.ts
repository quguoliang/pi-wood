import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateRunUsage, type RunUsageInput } from "./usage.ts";

const usage = (input: number, output: number, cost: number): RunUsageInput["usage"] => ({
  input,
  output,
  cacheRead: 0,
  cacheWrite: 0,
  cost,
  contextTokens: 0,
  turns: 1,
});
const run = (id: string, agent: string, u: RunUsageInput["usage"], elapsedMs = 0): RunUsageInput => ({ id, agent, elapsedMs, usage: u });

test("空注册表 → undefined（不显示该行）", () => {
  assert.equal(aggregateRunUsage([]), undefined);
});

test("单 child：tokens = input+output，cost 透传，perChild 明细齐", () => {
  const agg = aggregateRunUsage([run("r1", "explore", usage(7700, 66, 0.0011), 1234)]);
  assert.ok(agg);
  assert.equal(agg.tokens, 7766);
  assert.equal(agg.cost, 0.0011);
  assert.equal(agg.count, 1);
  assert.deepEqual(agg.perChild, [{ id: "r1", agentName: "explore", tokens: 7766, cost: 0.0011, elapsedMs: 1234 }]);
});

test("多 child：汇总为各 child 之和", () => {
  const agg = aggregateRunUsage([
    run("a", "explore", usage(100, 20, 0.001)),
    run("b", "general", usage(50, 10, 0.002)),
    run("c", "general", usage(1, 1, 0.0005)),
  ]);
  assert.ok(agg);
  assert.equal(agg.tokens, 120 + 60 + 2);
  assert.equal(agg.cost, round(0.0035));
  assert.equal(agg.count, 3);
  assert.deepEqual(agg.perChild.map((p) => p.agentName), ["explore", "general", "general"]);
});

test("脏数据稳健：负数/NaN/缺字段归零、不抛", () => {
  const dirty = [
    { id: "x", agent: "explore", elapsedMs: -5, usage: { input: NaN, output: 10, cacheRead: 0, cacheWrite: 0, cost: -1, contextTokens: 0, turns: 0 } },
    run("y", "general", usage(5, 5, Number.NaN)),
  ] as RunUsageInput[];
  const agg = aggregateRunUsage(dirty);
  assert.ok(agg);
  assert.equal(agg.tokens, 10 + 10); // x: NaN→0 +10 ; y: 5+5
  assert.equal(agg.cost, 0); // 负数/NaN 归零
  assert.equal(agg.perChild[0].elapsedMs, 0);
});

test("费用浮点尾噪归整到 6 位小数", () => {
  const agg = aggregateRunUsage([
    run("a", "g", usage(0, 0, 0.001)),
    run("b", "g", usage(0, 0, 0.002)),
    run("c", "g", usage(0, 0, 0.004)),
  ]);
  assert.ok(agg);
  assert.equal(agg.cost, 0.007); // 而非 0.006999999…
});

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
