import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteTask,
  readState,
  reconcileTasks,
  scanLoopFiles,
  updateRunRecord,
  upsertManualTask,
  withStateLock,
  writeLoopFile,
  writeState,
} from "./loop-store.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "loops-test-"));
}

test("writeLoopFile → scanLoopFiles 往返", () => {
  const dir = tmp();
  try {
    const p = writeLoopFile(dir, "nightly", {
      name: "nightly",
      schedule: "0 2 * * *",
      enabled: true,
      prompt: "跑夜间审查",
    });
    const found = scanLoopFiles(dir, "/proj");
    assert.equal(found.length, 1);
    assert.equal(found[0].task.name, "nightly");
    assert.equal(found[0].task.filePath, p);
    assert.equal(found[0].task.projectDir, "/proj");
    assert.equal(found[0].task.source, "file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanLoopFiles: 坏文件给 parseError 占位", () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, ".pi-wood", "loops"), { recursive: true });
    writeFileSync(join(dir, ".pi-wood", "loops", "bad.md"), "no frontmatter");
    const found = scanLoopFiles(dir);
    assert.equal(found.length, 1);
    assert.ok(found[0].parseError);
    assert.equal(found[0].task.enabled, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reconcileTasks: 文件 + manual 合并，run 记录回填", () => {
  const app = tmp();
  const scope = tmp();
  try {
    writeLoopFile(scope, "a", { name: "a", schedule: "* * * * *", enabled: true, prompt: "x" });
    const manualId = upsertManualTask(app, null, { name: "m", schedule: "0 9 * * *", enabled: true, prompt: "y" });
    const fileId = reconcileTasks(app, [{ dir: scope }]).find((t) => t.source === "file")!.id;
    updateRunRecord(app, fileId, { lastRunAt: 123, lastStatus: "ok" });
    const tasks = reconcileTasks(app, [{ dir: scope }]);
    assert.equal(tasks.length, 2);
    assert.equal(tasks.find((t) => t.source === "file")!.run.lastRunAt, 123);
    assert.equal(tasks.find((t) => t.source === "manual")!.id, manualId);
  } finally {
    rmSync(app, { recursive: true, force: true });
    rmSync(scope, { recursive: true, force: true });
  }
});

test("deleteTask: manual 从 state 删、file 删文件", () => {
  const app = tmp();
  const scope = tmp();
  try {
    writeLoopFile(scope, "a", { name: "a", schedule: "* * * * *", enabled: true, prompt: "x" });
    const manualId = upsertManualTask(app, null, { name: "m", schedule: "* * * * *", enabled: true, prompt: "y" });
    let tasks = reconcileTasks(app, [{ dir: scope }]);
    deleteTask(app, tasks.find((t) => t.source === "file")!);
    deleteTask(app, tasks.find((t) => t.id === manualId)!);
    tasks = reconcileTasks(app, [{ dir: scope }]);
    assert.equal(tasks.length, 0);
    assert.deepEqual(readState(app).definitions, {});
  } finally {
    rmSync(app, { recursive: true, force: true });
    rmSync(scope, { recursive: true, force: true });
  }
});

test("withStateLock: 回调拿 state，写回用 writeState", async () => {
  const app = tmp();
  try {
    await withStateLock(app, (state) => {
      state.runs["x"] = { lastRunAt: 1 };
      writeState(app, state);
    });
    assert.equal(readState(app).runs["x"]?.lastRunAt, 1);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});
