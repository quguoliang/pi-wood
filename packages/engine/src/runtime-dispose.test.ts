import assert from "node:assert/strict";
import { test } from "node:test";
import { disposeRuntimeGracefully, emittedSessionShutdown, type DisposeStep } from "./runtime-dispose.ts";

function fakeRuntime(opts: {
  hasRuntimeDispose?: boolean;
  abortThrows?: boolean;
  disposeThrows?: boolean;
}) {
  const calls: string[] = [];
  const rt: Record<string, unknown> = {
    session: {
      abort: async () => {
        if (opts.abortThrows) throw new Error("abort boom");
        calls.push("abort");
      },
      dispose: () => calls.push("session.dispose"),
    },
  };
  if (opts.hasRuntimeDispose !== false) {
    rt.dispose = async () => {
      if (opts.disposeThrows) throw new Error("dispose boom");
      calls.push("runtime.dispose");
    };
  }
  return { rt, calls };
}

test("stop 走 runtime.dispose()：先 abort 再广播 session_shutdown，且不重复 session.dispose", async () => {
  const { rt, calls } = fakeRuntime({});
  const result = await disposeRuntimeGracefully(rt as never);
  assert.deepEqual(calls, ["abort", "runtime.dispose"]);
  assert.deepEqual(result.steps, ["abort", "runtime.dispose"] as DisposeStep[]);
  assert.ok(emittedSessionShutdown(result), "session_shutdown 必须被广播（否则 MCP 子进程不回收）");
});

test("老 SDK 无 runtime.dispose → 退回 session.dispose 并可被检出未广播", async () => {
  const { rt, calls } = fakeRuntime({ hasRuntimeDispose: false });
  const result = await disposeRuntimeGracefully(rt as never);
  assert.deepEqual(calls, ["abort", "session.dispose"]);
  assert.equal(emittedSessionShutdown(result), false);
});

test("abort 抛错不阻断关停（引擎切项目不许卡死）", async () => {
  const { rt, calls } = fakeRuntime({ abortThrows: true });
  const result = await disposeRuntimeGracefully(rt as never);
  assert.deepEqual(result.steps, ["abort-error", "runtime.dispose"] as DisposeStep[]);
  assert.ok(calls.includes("runtime.dispose"));
});

test("runtime 缺席（未启动即 stop）→ 空步骤、不抛错", async () => {
  const result = await disposeRuntimeGracefully(undefined);
  assert.deepEqual(result.steps, []);
  assert.equal(emittedSessionShutdown(result), false);
});
