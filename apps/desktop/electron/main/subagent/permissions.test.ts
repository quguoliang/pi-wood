import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildProfiles,
  clearAgentPermissions,
  extractDescription,
  profileNameFromFile,
  setToolPermission,
  type PermMap,
} from "./permissions.ts";

test("profileNameFromFile：去 .md/.markdown", () => {
  assert.equal(profileNameFromFile("explore.md"), "explore");
  assert.equal(profileNameFromFile("general.markdown"), "general");
});

test("extractDescription：普通/带引号/无 frontmatter/缺字段", () => {
  assert.equal(
    extractDescription('---\ndescription: 只读探查\nharness: pi\n---\n正文'),
    "只读探查",
  );
  assert.equal(extractDescription('---\ndescription: "quoted text"\n---\n'), "quoted text");
  assert.equal(extractDescription("# 无 frontmatter"), undefined);
  assert.equal(extractDescription("---\nname: x\n---\n"), undefined);
});

test("setToolPermission：设置→存在；inherit→删除；空对象→删 agent 条目", () => {
  let m: PermMap = {};
  m = setToolPermission(m, "explore", "bash", "deny");
  assert.deepEqual(m, { explore: { bash: "deny" } });
  m = setToolPermission(m, "explore", "edit", "allow");
  assert.deepEqual(m.explore, { bash: "deny", edit: "allow" });
  m = setToolPermission(m, "explore", "bash", "inherit");
  assert.deepEqual(m.explore, { edit: "allow" });
  m = setToolPermission(m, "explore", "edit", "inherit");
  assert.equal("explore" in m, false); // 清空后整个 agent 条目删除
});

test("setToolPermission 不可变：不改原对象", () => {
  const base: PermMap = { a: { bash: "ask" } };
  const next = setToolPermission(base, "a", "edit", "deny");
  assert.deepEqual(base, { a: { bash: "ask" } });
  assert.deepEqual(next, { a: { bash: "ask", edit: "deny" } });
});

test("clearAgentPermissions 只删指定 agent", () => {
  const m: PermMap = { a: { bash: "deny" }, b: { edit: "allow" } };
  const next = clearAgentPermissions(m, "a");
  assert.deepEqual(next, { b: { edit: "allow" } });
});

test("buildProfiles：目录 ∪ 已配置；仅配置过的 inAgentsDir=false；permissions 正确", () => {
  const scanned = [{ name: "explore", description: "只读" }, { name: "general" }];
  const configured: PermMap = { explore: { bash: "deny" }, ghost: { write: "ask" } };
  const out = buildProfiles(scanned, configured);
  assert.deepEqual(out.map((p) => p.name), ["explore", "general", "ghost"]); // 名字排序
  assert.deepEqual(out.find((p) => p.name === "explore"), {
    name: "explore",
    description: "只读",
    inAgentsDir: true,
    permissions: { bash: "deny" },
  });
  assert.equal(out.find((p) => p.name === "general")?.description, undefined);
  assert.deepEqual(out.find((p) => p.name === "general")!.permissions, {});
  const ghost = out.find((p) => p.name === "ghost")!;
  assert.equal(ghost.inAgentsDir, false);
  assert.deepEqual(ghost.permissions, { write: "ask" });
});
