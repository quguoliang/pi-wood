import assert from "node:assert/strict";
import test from "node:test";
import { requirePi } from "./preload-api.ts";
import {
  describeError,
  formatErrorReport,
  GENERIC_HINT,
  isPreloadContractError,
  missingFunctionName,
  PRELOAD_HINT,
  recoveryHint,
  safeStringify,
} from "./error-report.ts";

/**
 * 这组断言守的是**给用户看的那部分**错误呈现，不是内部日志格式：
 * - 任意抛出物（含 `throw undefined`、循环引用对象、BigInt）都必须得到可读结果，
 *   且 describeError／safeStringify **自己绝不能抛**——否则 fallback 渲染时二次崩溃，
 *   边界接不住自己的错，用户仍然白屏（这是最坏情况：错误处理器成为新的错误源）。
 * - 「preload 契约缺失」必须被识别出来并给出**重启应用**的处置，
 *   而不是让用户反复点「重试」——刷新页面根本换不掉 preload。
 */

test("Error 实例：name／message／stack 透传", () => {
  const err = new TypeError("pi.fsImage is not a function");
  const r = describeError(err);
  assert.equal(r.name, "TypeError");
  assert.equal(r.message, "pi.fsImage is not a function");
  assert.ok(r.stack && r.stack.includes("TypeError"), "应带上堆栈");
});

test("name 为空 / message 为空时不产出空字符串", () => {
  const noName = new Error("boom");
  noName.name = "";
  assert.equal(describeError(noName).name, "Error");

  const noMsg = new Error("");
  const r = describeError(noMsg);
  assert.equal(r.message, "Error");
  assert.notEqual(r.message, "");
});

test("字符串抛出：归一为 Error + 原串消息", () => {
  assert.deepEqual(describeError("磁盘满了"), { name: "Error", message: "磁盘满了" });
});

test("非 Error 非字符串：一律 UnknownError，且不抛", () => {
  for (const [label, value] of [
    ["undefined", undefined],
    ["null", null],
    ["数字", 42],
    ["布尔", false],
  ] as const) {
    const r = describeError(value);
    assert.equal(r.name, "UnknownError", `${label} 应为 UnknownError`);
    assert.equal(typeof r.message, "string");
  }
});

test("throw undefined 也能得到可读结果（不能与「无错误」混淆的回归点）", () => {
  const r = describeError(undefined);
  assert.equal(r.name, "UnknownError");
  assert.equal(r.message, "undefined");
});

test("safeStringify 对循环引用／BigInt／Symbol／无原型对象都不抛", () => {
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic.self = cyclic;
  assert.equal(safeStringify(cyclic), "[object Object]");

  assert.equal(safeStringify(10n), "10");
  assert.equal(safeStringify(Symbol("s")), "Symbol(s)");

  const bare = Object.create(null) as Record<string, unknown>;
  assert.equal(safeStringify(bare), "{}");
});

test("safeStringify 极端值：JSON 与 String 双双失败时仍有兜底文案", () => {
  // toJSON 返回 undefined ⇒ JSON.stringify 给不出字符串；无原型 ⇒ String() 抛 TypeError
  const hostile = Object.create(null) as { toJSON?: () => undefined };
  hostile.toJSON = () => undefined;
  assert.equal(safeStringify(hostile), "[无法序列化的值]");
});

test("preload 契约缺失的识别：requirePi 的错、被包装的错都算", () => {
  const real = ((): unknown => {
    try {
      requirePi(undefined, "fsImage");
      return undefined;
    } catch (err) {
      return err;
    }
  })();
  assert.equal(isPreloadContractError(real), true, "requirePi 抛出的必须被识别");
  assert.equal(isPreloadContractError(new Error(`加载失败：${PRELOAD_HINT} preload 未提供 fsRead`)), true);
  assert.equal(isPreloadContractError("preload 未提供 fsRead"), true);
  assert.equal(isPreloadContractError(undefined), false);
});

test("真机形态：原生 TypeError「X is not a function」且 X 确实不在 preload 上 ⇒ 判为契约缺失", () => {
  // 这正是 2026-09-12 白屏报障的原话：Uncaught TypeError: window.pi.fsImage is not a function
  assert.equal(isPreloadContractError(new TypeError("window.pi.fsImage is not a function"), {}), true);
  assert.equal(isPreloadContractError(new TypeError("window.pi.fsImage is not a function"), { fsRead: () => 1 }), true);
  // 压缩后的变量前缀会变（pi → e），函数名不变 ⇒ 判据只能落在函数名上
  assert.equal(isPreloadContractError(new TypeError("e.fsImage is not a function"), {}), true);
});

test("负向对照：函数在 preload 上 / 业务错误 ⇒ 都不劝人重启", () => {
  assert.equal(isPreloadContractError(new TypeError("helper is not a function"), { helper: () => 1 }), false);
  assert.equal(isPreloadContractError(new Error("渲染失败"), {}), false);
  assert.equal(isPreloadContractError(new Error("接口超时"), {}), false);
  assert.equal(recoveryHint(new Error("渲染失败"), {}), GENERIC_HINT);
});

test("window.pi 整体未注入：读它的属性必然失败 ⇒ 判为契约缺失", () => {
  const err = new TypeError("Cannot read properties of undefined (reading 'fsImage')");
  assert.equal(isPreloadContractError(err, undefined), true);
  // 但已有 preload 对象时，同样的消息不再归因于契约缺失（避免误伤业务代码）
  assert.equal(isPreloadContractError(err, {}), false);
});

test("缺函数名提取：带不带前缀都能取到稳定的函数名", () => {
  assert.equal(missingFunctionName(new TypeError("window.pi.fsImage is not a function")), "fsImage");
  assert.equal(missingFunctionName(new TypeError("e.fsImage is not a function")), "fsImage");
  assert.equal(missingFunctionName(new TypeError("pi.fsMissing is not a function")), "fsMissing");
  assert.equal(missingFunctionName(new TypeError("对象不可用")), undefined);
});

test("处置建议：契约缺失指向重启，其余指向重试", () => {
  assert.equal(recoveryHint(new Error("preload 未提供 fsImage")), PRELOAD_HINT);
  assert.match(PRELOAD_HINT, /退出应用/);

  const generic = recoveryHint(new Error("渲染失败"));
  assert.equal(generic.indexOf("重试") >= 0, true);
  assert.equal(generic === PRELOAD_HINT, false);
});

test("formatErrorReport：含区域／时间／类型／消息／处置，堆栈可选", () => {
  const at = new Date("2026-09-12T01:45:00.000Z");
  const withStack = formatErrorReport(new TypeError("boom"), "右侧面板", at);
  assert.match(withStack, /右侧面板 崩溃/);
  assert.match(withStack, /2026-09-12T01:45:00\.000Z/);
  assert.match(withStack, /类型：TypeError/);
  assert.match(withStack, /消息：boom/);
  assert.match(withStack, /处置：/);
  assert.match(withStack, /堆栈：/);

  const noStack = new Error("x");
  delete (noStack as { stack?: string }).stack;
  const plain = formatErrorReport(noStack, "应用", at);
  assert.equal(plain.includes("堆栈："), false, "无堆栈时不应出现空堆栈小节");
});
