import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDelta,
  monthKey,
  parseStore,
  providerTotals,
  quotaWarnings,
  serializeStore,
  toEntries,
  type UsageStore,
} from "./usage-core.ts";

test("monthKey：UTC YYYY-MM，跨月产生不同键（用量重置的基础）", () => {
  assert.equal(monthKey(Date.UTC(2026, 8, 3)), "2026-09"); // 9=Sep
  assert.equal(monthKey(Date.UTC(2026, 9, 1)), "2026-10");
  assert.notEqual(monthKey(Date.UTC(2026, 8, 30)), monthKey(Date.UTC(2026, 9, 1)));
});

test("parse/serialize 往返 + 坏输入降级空", () => {
  const s = addDelta({}, "openai", "gpt-4o", { input: 10, output: 5, cost: 0.1 });
  assert.deepEqual(parseStore(serializeStore(s)), s);
  assert.deepEqual(parseStore(""), {});
  assert.deepEqual(parseStore("nope"), {});
  assert.deepEqual(parseStore("[1,2]"), {});
});

test("parseStore 丢弃非法项、归一负/非数为 0", () => {
  const got = parseStore('{"p":{"m":{"input":-5,"output":"x","total":3,"cost":0.2},"bad":123},"empty":{}}');
  assert.deepEqual(got, { p: { m: { input: 0, output: 0, total: 3, cost: 0.2 } } });
});

test("addDelta：累计、total 缺省=input+output、不可变", () => {
  const base: UsageStore = {};
  const a = addDelta(base, "deepseek", "chat", { input: 100, output: 20, cost: 0.5 });
  assert.deepEqual(a.deepseek?.chat, { input: 100, output: 20, total: 120, cost: 0.5 });
  assert.deepEqual(base, {}); // 未改原对象
  const b = addDelta(a, "deepseek", "chat", { input: 50, output: 10, total: 60, cost: 0.1 });
  assert.deepEqual(b.deepseek?.chat, { input: 150, output: 30, total: 180, cost: 0.6 });
});

test("addDelta：provider / model 维度分开累加", () => {
  let s: UsageStore = {};
  s = addDelta(s, "openai", "gpt-4o", { input: 1, output: 1, cost: 0.01 });
  s = addDelta(s, "openai", "gpt-4o-mini", { input: 2, output: 2, cost: 0.02 });
  s = addDelta(s, "anthropic", "claude", { input: 3, output: 3, cost: 0.03 });
  assert.deepEqual(Object.keys(s), ["openai", "anthropic"]);
  assert.deepEqual(Object.keys(s.openai ?? {}), ["gpt-4o", "gpt-4o-mini"]);
});

test("addDelta：零增量 / 缺 provider|model → 不改", () => {
  assert.deepEqual(addDelta({}, "p", "m", { input: 0, output: 0, cost: 0 }), {});
  assert.deepEqual(addDelta({}, "", "m", { input: 5 }), {});
  assert.deepEqual(addDelta({}, "p", "", { input: 5 }), {});
});

test("toEntries：摊平并按 provider→model 排序", () => {
  let s: UsageStore = {};
  s = addDelta(s, "b", "m2", { input: 1, output: 1, cost: 0 });
  s = addDelta(s, "a", "z", { input: 1, output: 1, cost: 0 });
  s = addDelta(s, "a", "y", { input: 1, output: 1, cost: 0 });
  const e = toEntries(s);
  assert.deepEqual(e.map((x) => `${x.providerId}/${x.modelId}`), ["a/y", "a/z", "b/m2"]);
});

test("providerTotals：跨 model 汇总 tokens/cost", () => {
  let s: UsageStore = {};
  s = addDelta(s, "p", "m1", { input: 10, output: 5, cost: 0.25 });
  s = addDelta(s, "p", "m2", { input: 20, output: 8, cost: 0.5 });
  const t = providerTotals(s);
  assert.deepEqual(t[0], { providerId: "p", tokens: { input: 30, output: 13, total: 43 }, cost: 0.75 });
});

test("quotaWarnings：token/cost 达阈各报、未配/未超不报", () => {
  let s: UsageStore = {};
  s = addDelta(s, "over", "m", { input: 60, output: 40, cost: 1.2 }); // total 100, cost 1.2
  s = addDelta(s, "under", "m", { input: 1, output: 1, cost: 0.001 });
  const warn = quotaWarnings(providerTotals(s), {
    over: { monthlyTokenBudget: 100, monthlyCostBudget: 1 },
    under: { monthlyTokenBudget: 1000 },
    unset: { monthlyTokenBudget: 1 },
  });
  const o = warn.find((w) => w.providerId === "over");
  assert.deepEqual(o, { providerId: "over", overTokens: true, overCost: true });
  assert.equal(warn.some((w) => w.providerId === "under"), false);
  assert.equal(warn.some((w) => w.providerId === "unset"), false); // 无该 provider 用量则不出现在 totals
});
