import { test } from "node:test";
import assert from "node:assert/strict";
import { pickAuxModel, type ModelRef } from "./model-pick.ts";

const models: ModelRef[] = [
  { provider: "deepseek", id: "deepseek-chat" },
  { provider: "openai", id: "gpt-4o-mini" },
];

test("smallModel 有效 → 优先小模型", () => {
  assert.deepEqual(
    pickAuxModel(models, { provider: "openai", id: "gpt-4o-mini" }, { provider: "deepseek", id: "deepseek-chat" }),
    { provider: "openai", id: "gpt-4o-mini" },
  );
});

test("smallModel 缺省/无效 → 回退默认模型", () => {
  assert.deepEqual(pickAuxModel(models, undefined, { provider: "deepseek", id: "deepseek-chat" }), { provider: "deepseek", id: "deepseek-chat" });
  assert.deepEqual(pickAuxModel(models, { provider: "ghost", id: "gone" }, { provider: "deepseek", id: "deepseek-chat" }), { provider: "deepseek", id: "deepseek-chat" });
  assert.deepEqual(pickAuxModel(models, null, { provider: "deepseek", id: "deepseek-chat" }), { provider: "deepseek", id: "deepseek-chat" });
});

test("两者都无/无效 → 可用列表首个", () => {
  assert.deepEqual(pickAuxModel(models), { provider: "deepseek", id: "deepseek-chat" });
  assert.deepEqual(pickAuxModel(models, undefined, { provider: "nope", id: "no" }), { provider: "deepseek", id: "deepseek-chat" });
});

test("空列表 → undefined", () => {
  assert.equal(pickAuxModel([], { provider: "a", id: "b" }), undefined);
});
