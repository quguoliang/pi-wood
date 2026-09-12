import assert from "node:assert/strict";
import test from "node:test";
import { requirePi } from "./preload-api.ts";

/**
 * 这组断言守的是两条**交互口径**，不是实现细节：
 * - preload 方法缺失时必须**抛**（响亮），绝不能返回 undefined 让调用方静默继续
 *   ——「静默吞」的先例：`window.pi.sessionsDelete?.()` ⇒「UI 说已删除、文件仍在盘上」。
 * - 抛出的错误必须**可读且可操作**（点出方法名 + 告诉用户重启应用），因为调用方会把它
 *   直接显示到界面上。真机报障场景：改了 preload 没重启 Electron ⇒ 全屏白屏。
 */

test("方法存在时原样返回（同一引用，不包装、不改语义）", () => {
  const fn = (p: string): Promise<string> => Promise.resolve(p);
  assert.equal(requirePi(fn, "fsRead"), fn);
});

test("返回后可直接调用，返回值不被改动", async () => {
  const fn = async (p: string): Promise<string> => `got:${p}`;
  assert.equal(await requirePi(fn, "fsRead")("a.ts"), "got:a.ts");
});

test("undefined / null / 非函数一律抛错（不静默返回 undefined）", () => {
  for (const [label, value] of [
    ["undefined", undefined],
    ["null", null],
    ["字符串", "fsRead"],
    ["对象", {}],
    ["数字", 0],
  ] as const) {
    assert.throws(
      () => requirePi(value as unknown, "fsRead"),
      /preload 未提供 fsRead/,
      `${label} 必须抛错`,
    );
  }
});

test("错误信息点出方法名并给出可操作指引（调用方会直接显示它）", () => {
  try {
    requirePi(undefined, "fsImage");
    assert.fail("应当抛错");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    assert.match(msg, /fsImage/);
    assert.match(msg, /重启/);
  }
});
