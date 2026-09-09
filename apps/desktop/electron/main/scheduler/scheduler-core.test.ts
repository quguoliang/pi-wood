import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canClaim,
  nextRun,
  parseCron,
  parseLoopFile,
  recordRun,
  serializeLoopFile,
  taskIdFor,
  validateDefinition,
} from "./scheduler-core.ts";

test("parseCron: 合法表达式", () => {
  const s = parseCron("*/5 9-17 1,15 * 1-5");
  assert.ok(s);
  assert.deepEqual(s.minute, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  assert.deepEqual(s.hour, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual(s.dayOfMonth, [1, 15]);
  assert.deepEqual(s.month, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(s.dayOfWeek, [1, 2, 3, 4, 5]);
});

test("parseCron: 7 归一为周日 0", () => {
  const s = parseCron("0 0 * * 7");
  assert.deepEqual(s?.dayOfWeek, [0]);
});

test("parseCron: 非法输入返回 null", () => {
  assert.equal(parseCron(""), null);
  assert.equal(parseCron("* * * *"), null);
  assert.equal(parseCron("* * * * * *"), null);
  assert.equal(parseCron("61 * * * *"), null);
  assert.equal(parseCron("*/0 * * * *"), null);
  assert.equal(parseCron("a b c d e"), null);
  assert.equal(parseCron("5-1 * * * *"), null);
});

test("nextRun: 每分钟从下一分钟整开始", () => {
  const s = parseCron("* * * * *");
  assert.ok(s);
  const from = new Date(2026, 8, 9, 10, 30, 15).getTime(); // 10:30:15
  const next = nextRun(s, from);
  assert.equal(next, new Date(2026, 8, 9, 10, 31, 0).getTime());
});

test("nextRun: 定点时间", () => {
  const s = parseCron("30 9 * * *");
  assert.ok(s);
  // 9:29 → 9:30
  assert.equal(nextRun(s, new Date(2026, 8, 9, 9, 29, 0).getTime()), new Date(2026, 8, 9, 9, 30, 0).getTime());
  // 9:30 → 次日 9:30
  assert.equal(nextRun(s, new Date(2026, 8, 9, 9, 30, 0).getTime()), new Date(2026, 8, 10, 9, 30, 0).getTime());
});

test("nextRun: 每周一 0 点", () => {
  const s = parseCron("0 0 * * 1");
  assert.ok(s);
  // 2026-09-09 是周三
  const next = nextRun(s, new Date(2026, 8, 9, 12, 0, 0).getTime());
  const d = new Date(next!);
  assert.equal(d.getDay(), 1);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
});

test("nextRun: dom/dow 双受限取并集（Vixie 语义）", () => {
  const s = parseCron("0 0 15 * 3"); // 每月 15 号 或 每周三
  assert.ok(s);
  // 2026-09-09 周三（非 15 号）12:00 → 下个周三 09-16 是周三且也是并集之一…先找 9/15（周二）
  const next = nextRun(s, new Date(2026, 8, 9, 12, 0, 0).getTime());
  const d = new Date(next!);
  assert.ok(d.getDate() === 15 || d.getDay() === 3);
});

test("parseLoopFile: 完整 frontmatter", () => {
  const text = `---
name: nightly-review
schedule: 0 2 * * *
enabled: true
model: deepseek/deepseek-v4-flash
agent: reviewer
timezone: Asia/Shanghai
---
请审查今天的改动并汇总。
`;
  const def = parseLoopFile(text);
  assert.ok(def);
  assert.equal(def.name, "nightly-review");
  assert.equal(def.schedule, "0 2 * * *");
  assert.equal(def.enabled, true);
  assert.equal(def.model, "deepseek/deepseek-v4-flash");
  assert.equal(def.agent, "reviewer");
  assert.equal(def.timezone, "Asia/Shanghai");
  assert.equal(def.prompt, "请审查今天的改动并汇总。");
});

test("parseLoopFile: enabled=false 生效；缺 name/schedule/坏 cron → null", () => {
  const disabled = parseLoopFile(`---\nname: a\nschedule: * * * * *\nenabled: false\n---\nhi`);
  assert.equal(disabled?.enabled, false);
  assert.equal(parseLoopFile(`---\nschedule: * * * * *\n---\nhi`), null);
  assert.equal(parseLoopFile(`---\nname: a\n---\nhi`), null);
  assert.equal(parseLoopFile(`---\nname: a\nschedule: 99 * * * *\n---\nhi`), null);
  assert.equal(parseLoopFile(`no frontmatter`), null);
});

test("serializeLoopFile ↔ parseLoopFile 往返", () => {
  const def = {
    name: "t",
    schedule: "*/10 * * * *",
    enabled: false,
    model: "p/m",
    prompt: "do something\n多行",
  };
  const round = parseLoopFile(serializeLoopFile(def));
  assert.ok(round);
  assert.equal(round.name, def.name);
  assert.equal(round.schedule, def.schedule);
  assert.equal(round.enabled, false);
  assert.equal(round.model, "p/m");
  assert.equal(round.prompt, "do something\n多行");
});

test("taskIdFor: file 源稳定、manual 源唯一", () => {
  assert.equal(taskIdFor("file", "/a/b/c.md"), taskIdFor("file", "/a/b/c.md"));
  assert.notEqual(taskIdFor("manual", "x"), taskIdFor("manual", "x"));
  assert.ok(taskIdFor("file", "/a/b/c.md").startsWith("file:"));
});

test("recordRun: 成功/失败状态迁移", () => {
  const ok = recordRun({}, { ok: true, sessionId: "s1", durationMs: 100, ranAt: 1000, nextAt: 2000 });
  assert.equal(ok.lastStatus, "ok");
  assert.equal(ok.lastRunAt, 1000);
  assert.equal(ok.nextRunAt, 2000);
  assert.equal(ok.lastSessionId, "s1");
  assert.equal(ok.lastError, undefined);
  const err = recordRun(ok, { ok: false, error: "boom", ranAt: 3000, nextAt: null });
  assert.equal(err.lastStatus, "error");
  assert.equal(err.lastError, "boom");
  assert.equal(err.nextRunAt, undefined);
});

test("canClaim: occurrence 防双开", () => {
  assert.equal(canClaim({}, 100), true);
  assert.equal(canClaim({ lastScheduledFor: 100 }, 100), false);
  assert.equal(canClaim({ lastScheduledFor: 100 }, 200), true);
});

test("validateDefinition: 各项校验", () => {
  const base = { name: "a", schedule: "* * * * *", enabled: true, prompt: "hi" };
  assert.equal(validateDefinition(base), null);
  assert.ok(validateDefinition({ ...base, name: " " }));
  assert.ok(validateDefinition({ ...base, schedule: "bad" }));
  assert.ok(validateDefinition({ ...base, prompt: "" }));
  assert.ok(validateDefinition({ ...base, timezone: "Not/AZone" }));
  assert.equal(validateDefinition({ ...base, timezone: "Asia/Shanghai" }), null);
});
