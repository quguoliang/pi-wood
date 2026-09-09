import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureScheduler,
  createManualTask,
  listTasks,
  removeTask,
  runTaskNow,
  setSchedulerAdapter,
  startScheduler,
  stopScheduler,
  tickOnce,
  updateTask,
  type SchedulerAdapter,
} from "./scheduler-runtime.ts";
import { readState } from "./loop-store.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "sched-rt-"));
}

function fakeAdapter(calls: Array<{ name: string; prompt: string }>, fail = false): SchedulerAdapter {
  return {
    async runTask(task) {
      calls.push({ name: task.name, prompt: task.prompt });
      if (fail) throw new Error("engine down");
      return { sessionId: "sess-" + calls.length };
    },
    listProjectDirs: () => [],
  };
}

test("createManualTask/listTasks/updateTask/removeTask 全链", () => {
  const app = tmp();
  try {
    configureScheduler({ appDataDir: app });
    const bad = createManualTask({ name: "x", schedule: "bad", enabled: true, prompt: "p" });
    assert.ok(bad.error);
    const ok = createManualTask({ name: "每分", schedule: "* * * * *", enabled: true, prompt: "p" });
    assert.ok(ok.id);
    let tasks = listTasks();
    assert.equal(tasks.length, 1);
    assert.ok(tasks[0].run.nextRunAt); // enabled 补 nextRunAt
    const err = updateTask(ok.id!, { enabled: false });
    assert.equal(err.error, undefined);
    tasks = listTasks();
    assert.equal(tasks[0].enabled, false);
    assert.equal(tasks[0].run.nextRunAt, undefined);
    assert.equal(removeTask(ok.id!).error, undefined);
    assert.equal(listTasks().length, 0);
    assert.ok(removeTask("nonexistent").error);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test("runTaskNow: 触发 adapter 并记 run 记录", async () => {
  const app = tmp();
  const calls: Array<{ name: string; prompt: string }> = [];
  try {
    configureScheduler({ appDataDir: app, adapter: fakeAdapter(calls) });
    const { id } = createManualTask({ name: "t", schedule: "* * * * *", enabled: true, prompt: "do it" });
    await runTaskNow(id!);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prompt, "do it");
    const run = readState(app).runs[id!];
    assert.equal(run.lastStatus, "ok");
    assert.equal(run.lastSessionId, "sess-1");
    assert.ok(run.lastRunAt);
    assert.ok(run.nextRunAt);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test("runTaskNow: adapter 抛错 → lastStatus=error", async () => {
  const app = tmp();
  try {
    configureScheduler({ appDataDir: app, adapter: fakeAdapter([], true) });
    const { id } = createManualTask({ name: "t", schedule: "* * * * *", enabled: true, prompt: "p" });
    await runTaskNow(id!);
    const run = readState(app).runs[id!];
    assert.equal(run.lastStatus, "error");
    assert.equal(run.lastError, "engine down");
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test("tickOnce: 到期任务触发 + occurrence 防双开", async () => {
  const app = tmp();
  const calls: Array<{ name: string; prompt: string }> = [];
  const now = new Date(2026, 8, 9, 10, 30, 10).getTime();
  try {
    configureScheduler({ appDataDir: app, adapter: fakeAdapter(calls), now: () => now });
    createManualTask({ name: "a", schedule: "* * * * *", enabled: true, prompt: "p1" });
    createManualTask({ name: "b", schedule: "0 9 * * *", enabled: true, prompt: "p2" }); // 不到期
    createManualTask({ name: "c", schedule: "* * * * *", enabled: false, prompt: "p3" }); // 禁用
    const fired = await tickOnce();
    assert.equal(fired, 1);
    // 等异步 fire 完成
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "a");
    // 同一 now 再 tick：occurrence 已认领 → 0
    assert.equal(await tickOnce(), 0);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test("startScheduler/stopScheduler: 计时器起停", async () => {
  const app = tmp();
  try {
    configureScheduler({ appDataDir: app, adapter: fakeAdapter([]), tickMs: 60 });
    startScheduler();
    await new Promise((r) => setTimeout(r, 150));
    stopScheduler();
    stopScheduler(); // 幂等
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test("setSchedulerAdapter: 热替换", async () => {
  const app = tmp();
  const calls: Array<{ name: string; prompt: string }> = [];
  try {
    configureScheduler({ appDataDir: app });
    const { id } = createManualTask({ name: "t", schedule: "* * * * *", enabled: true, prompt: "p" });
    await runTaskNow(id!); // adapter=null → error
    assert.equal(readState(app).runs[id!].lastStatus, "error");
    setSchedulerAdapter(fakeAdapter(calls));
    await runTaskNow(id!);
    assert.equal(readState(app).runs[id!].lastStatus, "ok");
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});
