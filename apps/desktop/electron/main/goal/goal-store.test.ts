import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearGoal, goalsDir, readAllGoalStates, readGoalState, writeGoalState, writeObjective } from "./goal-store.ts";
import type { GoalState } from "@pi-wood/ipc-schema";

const state = (sessionId: string, over: Partial<GoalState> = {}): GoalState => ({
  sessionId,
  status: "active",
  objectiveChars: 8,
  turnsUsed: 0,
  maxTurns: 20,
  tokensUsed: 0,
  tokenBudget: 400_000,
  lastTotalTokens: 0,
  costUsd: 0,
  consecutiveBlocked: 0,
  auditFailures: 0,
  updatedAt: 1,
  ...over,
});

const freshDir = (): string => mkdtempSync(join(tmpdir(), "pi-wood-goal-store-"));

test("goalsDir：自动建目录且幂等（落盘/预热前不要求目录已存在）", () => {
  const appDataDir = join(freshDir(), "appdata");
  const dir = goalsDir(appDataDir);
  assert.ok(existsSync(dir));
  assert.equal(goalsDir(appDataDir), dir);
});

test("readGoalState：写后原样回读", () => {
  const dir = goalsDir(freshDir());
  writeGoalState(dir, state("s1", { status: "paused", turnsUsed: 3, note: "待用户澄清" }));
  const back = readGoalState(dir, "s1");
  assert.equal(back?.sessionId, "s1");
  assert.equal(back?.status, "paused");
  assert.equal(back?.turnsUsed, 3);
  assert.equal(back?.note, "待用户澄清");
});

test("readGoalState：缺文件 / 坏 JSON / 缺字段 → null（不抛）", () => {
  const dir = goalsDir(freshDir());
  assert.equal(readGoalState(dir, "missing"), null);
  writeFileSync(join(dir, "broken.state.json"), "{ not json");
  assert.equal(readGoalState(dir, "broken"), null);
  writeFileSync(join(dir, "partial.state.json"), JSON.stringify({ status: "active" }));
  assert.equal(readGoalState(dir, "partial"), null);
  writeFileSync(join(dir, "nullish.state.json"), "null");
  assert.equal(readGoalState(dir, "nullish"), null);
});

test("readAllGoalStates：全量读回，含本进程从未 load 过的会话（跨重启互斥的判据来源）", () => {
  const dir = goalsDir(freshDir());
  writeGoalState(dir, state("legacy-session", { status: "active" }));
  writeGoalState(dir, state("other-session", { status: "paused" }));
  const all = readAllGoalStates(dir);
  assert.equal(all.length, 2);
  const byId = new Map(all.map((s) => [s.sessionId, s]));
  assert.equal(byId.get("legacy-session")?.status, "active");
  assert.equal(byId.get("other-session")?.status, "paused");
});

test("readAllGoalStates：目录不存在 → 空数组（预热是旁路，不得阻断启动）", () => {
  assert.deepEqual(readAllGoalStates(join(freshDir(), "nope")), []);
});

test("readAllGoalStates：只认 *.state.json，忽略目标正文与其他文件", () => {
  const dir = goalsDir(freshDir());
  writeGoalState(dir, state("s1"));
  writeObjective(dir, "s1", "在 README 里加一行测试文字");
  writeFileSync(join(dir, "notes.txt"), "随手记");
  mkdirSync(join(dir, "sub"), { recursive: true });
  writeFileSync(join(dir, "backup.state.json.bak"), JSON.stringify(state("ghost")));
  const all = readAllGoalStates(dir);
  assert.equal(all.length, 1);
  assert.equal(all[0]?.sessionId, "s1");
});

test("readAllGoalStates：坏文件被跳过，好文件照收（单个坏叶不得污染全量预热）", () => {
  const dir = goalsDir(freshDir());
  writeGoalState(dir, state("good"));
  writeFileSync(join(dir, "bad.state.json"), "{");
  writeFileSync(join(dir, "partial.state.json"), JSON.stringify({ status: "active" }));
  const all = readAllGoalStates(dir);
  assert.equal(all.length, 1);
  assert.equal(all[0]?.sessionId, "good");
});

test("readAllGoalStates：clearGoal 删除后不再返回（避免与 clearGoalFor 的内存语义分叉）", () => {
  const dir = goalsDir(freshDir());
  writeGoalState(dir, state("s1"));
  assert.equal(readAllGoalStates(dir).length, 1);
  clearGoal(dir, "s1");
  assert.deepEqual(readAllGoalStates(dir), []);
});
