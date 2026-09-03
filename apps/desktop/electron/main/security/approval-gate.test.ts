import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, type ApprovalPolicy, type ToolPermissionOverride } from "./approval-gate.ts";

const HIGH: ApprovalPolicy = { mode: "highRisk", rules: [] };
const AUTO: ApprovalPolicy = { mode: "auto", rules: [] };

test("无 override → 完全等同旧行为（highRisk 下 bash=ask、read=allow）", () => {
  assert.equal(decide(HIGH, "bash", { command: "ls" }), "ask");
  assert.equal(decide(HIGH, "read", { path: "a.txt" }), "allow");
});

test("override bash:deny 覆盖 highRisk 的 ask → deny", () => {
  const ov: ToolPermissionOverride = { bash: "deny" };
  assert.equal(decide(HIGH, "bash", { command: "rm" }, ov), "deny");
});

test("override bash:allow 覆盖 highRisk 的 ask → allow（auto 也 allow，验证 override 前置无副作用）", () => {
  const ov: ToolPermissionOverride = { bash: "allow" };
  assert.equal(decide(HIGH, "bash", { command: "ls" }, ov), "allow");
  assert.equal(decide(AUTO, "bash", { command: "ls" }, ov), "allow");
});

test("override write:allow 也不能越过 path-guard 敏感文件硬底线（.env → deny）", () => {
  const ov: ToolPermissionOverride = { write: "allow" };
  assert.equal(decide(HIGH, "write", { path: "/proj/.env", content: "x" }, ov), "deny");
});

test("override edit:allow 让普通文件写从 ask 变 allow", () => {
  const ov: ToolPermissionOverride = { edit: "allow" };
  assert.equal(decide(HIGH, "edit", { path: "/proj/src/a.ts", edits: [] }, ov), "allow");
});

test("全局 rules 命中优先于 per-tool override（用户显式规则 > 单代理授权）", () => {
  const policy: ApprovalPolicy = { mode: "auto", rules: [{ pattern: "deploy", action: "deny" }] };
  const ov: ToolPermissionOverride = { bash: "allow" };
  assert.equal(decide(policy, "bash", { command: "./deploy.sh" }, ov), "deny");
});

test("只读工具可被 override 收紧为 deny；未覆盖的只读工具仍默认 allow", () => {
  const ov: ToolPermissionOverride = { read: "deny" };
  assert.equal(decide(HIGH, "read", { path: "secret" }, ov), "deny");
  assert.equal(decide(HIGH, "grep", { pattern: "x" }, ov), "allow"); // grep 未在 override 表内
});

test("override 表内无该工具 → 回退全局策略（继承）", () => {
  const ov: ToolPermissionOverride = { edit: "deny" };
  assert.equal(decide(HIGH, "bash", { command: "ls" }, ov), "ask"); // bash 未覆盖，仍 highRisk=ask
});
