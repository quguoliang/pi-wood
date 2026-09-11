import { test } from "node:test";
import assert from "node:assert/strict";
import { GEN_UI_FENCE, GEN_UI_INSTRUCTION, gateGenUiPrompt, isGenUiEnabledFromSettings } from "./gen-ui-prompt.ts";

/* ---------------- 开关判定：默认必须关，任何异常输入都不得放开 ---------------- */

test("isGenUiEnabledFromSettings：显式 true 才开", () => {
  assert.equal(isGenUiEnabledFromSettings({ ui: { generativeUi: true } }), true);
});

test("isGenUiEnabledFromSettings：缺字段 / 空对象 → 关", () => {
  assert.equal(isGenUiEnabledFromSettings({}), false);
  assert.equal(isGenUiEnabledFromSettings({ ui: {} }), false);
  assert.equal(isGenUiEnabledFromSettings({ ui: { generativeUi: false } }), false);
});

test("isGenUiEnabledFromSettings：非布尔真值不得当开（'true' / 1 / 'yes'）", () => {
  assert.equal(isGenUiEnabledFromSettings({ ui: { generativeUi: "true" } }), false);
  assert.equal(isGenUiEnabledFromSettings({ ui: { generativeUi: 1 } }), false);
  assert.equal(isGenUiEnabledFromSettings({ ui: { generativeUi: "yes" } }), false);
  assert.equal(isGenUiEnabledFromSettings({ ui: { generativeUi: {} } }), false);
});

test("isGenUiEnabledFromSettings：整体非法输入不抛错且判关", () => {
  assert.equal(isGenUiEnabledFromSettings(null), false);
  assert.equal(isGenUiEnabledFromSettings(undefined), false);
  assert.equal(isGenUiEnabledFromSettings("garbage"), false);
  assert.equal(isGenUiEnabledFromSettings(42), false);
  assert.equal(isGenUiEnabledFromSettings({ ui: null }), false);
  assert.equal(isGenUiEnabledFromSettings([]), false);
});

/* ---------------- 提示词闸门：关 = 空数组，不是 [""] ---------------- */

test("gateGenUiPrompt：开 → 恰好一段内置指令", () => {
  const out = gateGenUiPrompt(true);
  assert.equal(out.length, 1);
  assert.equal(out[0], GEN_UI_INSTRUCTION);
});

test("gateGenUiPrompt：关 → 空数组（空字符串占位会把空段落拼进系统提示词）", () => {
  const out = gateGenUiPrompt(false);
  assert.equal(out.length, 0);
  assert.deepEqual(out, []);
});

/* ---------------- 指令文本与渲染层的契约（漂移守卫） ---------------- */

test("内置指令声明了围栏标记，且与 GEN_UI_FENCE 一致", () => {
  assert.equal(GEN_UI_FENCE, "genui");
  assert.ok(GEN_UI_INSTRUCTION.includes("```" + GEN_UI_FENCE), "指令里必须给出 ```genui 的示例围栏");
});

/**
 * 核心类名单：与 `packages/ui-kit/src/gen-ui-core.test.ts` 的 CORE_CLASSES 保持一致。
 * 两份单测各钉一次 —— 基线 CSS 里改名会让那边红，指令里漏写会让这里红。
 */
const CORE_CLASSES = [
  "pk-wrap", "pk-title", "pk-sub", "pk-card", "pk-grid", "pk-row", "pk-spread",
  "pk-badge", "pk-btn", "pk-btn-primary", "pk-step", "pk-num", "pk-flow",
  "pk-kv", "pk-ink", "pk-code", "pk-hint",
];

test("指令逐条给出类库（模型才有得抄，禁令单独压不住它的默认审美）", () => {
  for (const cls of CORE_CLASSES) {
    assert.ok(GEN_UI_INSTRUCTION.includes(cls), `指令缺少类 ${cls}`);
  }
});

test("指令给出可复制片段（≥3 段围栏示例）", () => {
  const fences = GEN_UI_INSTRUCTION.match(/```genui/g) ?? [];
  assert.ok(fences.length >= 4, `示例围栏应≥4 段（含格式示例），实际 ${fences.length}`);
});

test("指令明确禁止硬编码颜色 / 字号 / 写死高度（真机返工的两条主因）", () => {
  assert.ok(GEN_UI_INSTRUCTION.includes("禁止写颜色"));
  assert.ok(GEN_UI_INSTRUCTION.includes("font-size"));
  assert.ok(GEN_UI_INSTRUCTION.includes("禁止写死高度"));
  assert.ok(GEN_UI_INSTRUCTION.includes("100vh"));
  assert.ok(GEN_UI_INSTRUCTION.includes("width:100%"));
});

test("指令保留交互契约与沙箱说明", () => {
  assert.ok(GEN_UI_INSTRUCTION.includes("piwood.sendPrompt"));
  assert.ok(GEN_UI_INSTRUCTION.includes("data-piwood-prompt"));
  assert.ok(GEN_UI_INSTRUCTION.includes("沙箱"));
  assert.ok(GEN_UI_INSTRUCTION.includes("禁止网络请求"));
  assert.ok(!GEN_UI_INSTRUCTION.includes("allow-same-origin"), "指令文本不得出现同源放开字样");
});
