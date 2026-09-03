import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageTracker } from "./usage-tracker.ts";

function tracker(now0: number) {
  const dir = mkdtempSync(join(tmpdir(), "pi-wood-usage-"));
  let now = now0;
  const quota: Record<string, { monthlyTokenBudget?: number }> = {};
  const t = new UsageTracker({ appDataDir: dir, now: () => now, getQuota: () => quota });
  return { t, dir, setNow: (n: number) => (now = n), setQuota: (q: typeof quota) => Object.assign(quota, q) };
}

const SEP = Date.UTC(2026, 8, 15); // 2026-09
const OCT = Date.UTC(2026, 9, 1); // 2026-10

test("recordUsage：按会话累计快照求差、单调累加不重复计", () => {
  const { t, dir } = tracker(SEP);
  t.recordUsage("s1", "deepseek", "chat", { input: 100, output: 20, total: 120, cost: 0.5 });
  t.recordUsage("s1", "deepseek", "chat", { input: 180, output: 40, total: 220, cost: 0.9 }); // delta 80/20/100/0.4
  assert.ok(existsSync(join(dir, "usage", "2026-09.json")));
  const v = t.readUsage();
  assert.equal(v.entries.length, 1);
  assert.deepEqual(v.entries[0]?.tokens, { input: 180, output: 40, total: 220 });
  assert.equal(v.entries[0]?.cost.toFixed(2), "0.90");
});

test("recordUsage：累计值下降（新会话/回退）不产生负增量、不同会话分开归属", () => {
  const { t } = tracker(SEP);
  t.recordUsage("s1", "p", "m", { input: 500, output: 100, total: 600, cost: 1 });
  t.recordUsage("s2", "p", "m", { input: 10, output: 5, total: 15, cost: 0.1 }); // s2 baseline=0 → +15
  const v = t.readUsage();
  assert.equal(v.entries[0]?.tokens.total, 615); // 600 + 15（s2 无负增量）
});

test("跨月：新月份文件从 0 起、旧月不串", () => {
  const { t, setNow } = tracker(SEP);
  t.recordUsage("s", "p", "m", { input: 100, output: 50, total: 150, cost: 0.3 });
  assert.equal(t.readUsage("2026-09").entries[0]?.tokens.total, 150);
  setNow(OCT);
  t.recordUsage("s", "p", "m", { input: 100, output: 50, total: 150, cost: 0.3 }); // 同累计值、新月份 delta 因新基线？s 基线仍是 150 → delta 0
  assert.equal(t.readUsage("2026-10").entries.length, 0); // 无新增（基线未变）→ 10 月文件不存在/空
  t.recordUsage("s", "p", "m", { input: 160, output: 60, total: 220, cost: 0.4 }); // delta 70/10/... → 记入 10 月
  assert.ok(t.readUsage("2026-10").entries[0]!.tokens.total > 0);
  assert.equal(t.readUsage("2026-09").entries[0]?.tokens.total, 150); // 9 月不变
});

test("readUsage：provider 汇总 + 配额告警", () => {
  const { t, setQuota } = tracker(SEP);
  t.recordUsage("s", "openai", "gpt-4o", { input: 60, output: 40, total: 100, cost: 2 });
  setQuota({ openai: { monthlyTokenBudget: 100 } });
  const v = t.readUsage();
  assert.equal(v.totals[0]?.providerId, "openai");
  assert.equal(v.warnings.find((w) => w.providerId === "openai")?.overTokens, true);
});
