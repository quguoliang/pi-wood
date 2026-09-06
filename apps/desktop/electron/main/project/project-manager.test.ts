/**
 * project-manager 单元测试（T8.11 rename 验收 + remove 回归）
 * 用临时目录当 ~/.pi-wood，不碰真实注册表。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, after } from "node:test";
import { ProjectManager } from "./project-manager.ts";

const dir = mkdtempSync(join(tmpdir(), "pi-wood-pm-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function newManager(): ProjectManager {
  return new ProjectManager(dir, dir);
}

test("rename：改显示别名后 list 可见，目录 path 不变；空名回落目录名", () => {
  const pm = newManager();
  const project = pm.add("/tmp/pi-wood-fixture/demo-repo");
  const renamed = pm.rename(project.path, "演示仓库");
  assert.equal(renamed.name, "演示仓库");
  assert.equal(renamed.path, project.path);
  assert.equal(pm.list().find((p) => p.id === project.id)?.name, "演示仓库");
  const fallback = pm.rename(project.path, "   ");
  assert.equal(fallback.name, "demo-repo");
});

test("rename：未注册项目抛错（不静默造出孤儿记录）", () => {
  const pm = newManager();
  assert.throws(() => pm.rename("/tmp/pi-wood-fixture/never-added", "x"));
});

test("remove：移除后 list 不再包含，再次 remove 返回 false（幂等）", () => {
  const pm = newManager();
  const project = pm.add("/tmp/pi-wood-fixture/gone-repo");
  assert.equal(pm.remove(project.id), true);
  assert.equal(pm.list().some((p) => p.id === project.id), false);
  assert.equal(pm.remove(project.id), false);
});

test("构造：已存在的注册表文件按原样读取，不重置（升级不丢数据）", () => {
  writeFileSync(join(dir, "projects.json"), JSON.stringify({ projects: [{ id: "x", path: "/p", name: "n", addedAt: "", lastOpenedAt: "" }] }));
  const pm = newManager();
  assert.equal(pm.list().length, 1);
  assert.equal(pm.list()[0].name, "n");
});
