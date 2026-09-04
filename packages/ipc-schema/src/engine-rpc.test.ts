import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ENGINE_REVERSE_METHODS,
  ENGINE_RPC_METHODS,
  ENGINE_RPC_PARAM_SCHEMAS,
  ENGINE_RPC_VERSION,
  EngineDownFrameSchema,
  EngineUpFrameSchema,
  acceptSeq,
  decodeFrame,
  decodeFrameLoose,
  frameErrorText,
  isEngineReverseRpcMethod,
  isEngineRpcMethod,
  makeEvent,
  makeInvoke,
  makeRespond,
  nextFrameId,
  resetFrameIdForTest,
  validateRpcParams,
  type DecodeResult,
} from "./engine-rpc.ts";

/** 严格解码成功时取出帧；失败则把 error 文本一并写进断言报告，便于定位 */
function mustDecode<T>(res: DecodeResult<T>): T {
  if (!res.ok) throw new Error(`期望解码成功，实际失败：${res.error}`);
  return res.frame;
}

/**
 * 严格解码后按 kind 收窄：联合帧只有 kind / v 是公共字段，
 * 且带 `.default()` 的 v 让解码结果类型与导出的帧类型略有差异，故一律走泛型推断。
 */
function expectKind<T extends { kind: string }, K extends T["kind"]>(
  res: DecodeResult<T>,
  kind: K,
): Extract<T, { kind: K }> {
  const frame = mustDecode(res);
  if (frame.kind !== kind) throw new Error(`期望 ${kind} 帧，实际 ${String(frame.kind)}`);
  return frame as Extract<T, { kind: K }>;
}

/** 严格解码必须失败，并返回人类可读错误文本 */
function mustReject(res: DecodeResult<unknown>): string {
  if (res.ok) throw new Error(`期望解码失败，实际通过：${JSON.stringify(res.frame)}`);
  assert.ok(res.error.length > 0, "拒绝原因不能为空");
  return res.error;
}

function mustRejectParams(res: ReturnType<typeof validateRpcParams>): void {
  if (res.ok) throw new Error(`参数应被拒绝，实际通过：${JSON.stringify(res.value)}`);
  assert.ok(res.error.length > 0, "参数错误文本不能为空");
}

// 合法的上行 event 载荷（EngineEventSchema 的已知分支）
const OK_EVENT = { type: "agent_start" };

test("严格解码：下行 invoke 帧合法，v 缺省补齐为协议版本", () => {
  const invoke = expectKind(decodeFrame(EngineDownFrameSchema, {
    kind: "invoke",
    id: 7,
    method: "start",
    params: { projectDir: "/tmp/p" },
  }), "invoke");
  assert.equal(invoke.v, ENGINE_RPC_VERSION);
  assert.equal(invoke.method, "start");
  // 显式带 v 时按原值通过；0 是合法 id（保留给「无应答」帧）
  assert.equal(expectKind(decodeFrame(EngineDownFrameSchema, {
    v: ENGINE_RPC_VERSION,
    kind: "invoke",
    id: 0,
    method: "getState",
  }), "invoke").id, 0);
});

test("严格解码：respond 帧上下行共用，同一形状两侧都通过", () => {
  const raw = { kind: "respond", id: 3, ok: true, value: { pid: 1 } };
  const down = expectKind(decodeFrame(EngineDownFrameSchema, raw), "respond");
  const up = expectKind(decodeFrame(EngineUpFrameSchema, raw), "respond");
  assert.deepEqual(up, down);
  assert.equal(down.v, ENGINE_RPC_VERSION);
  assert.equal(down.ok, true);
  mustReject(decodeFrame(EngineDownFrameSchema, { kind: "respond", id: 3, ok: "true" }));
  mustReject(decodeFrame(EngineUpFrameSchema, { kind: "respond", id: 3, ok: true, error: 42 }));
});

test("严格解码：上行 event/hello/bye/log 帧合法且补齐 v", () => {
  assert.equal(expectKind(decodeFrame(EngineUpFrameSchema, { kind: "event", seq: 0, event: OK_EVENT }), "event").v, ENGINE_RPC_VERSION);
  assert.equal(expectKind(decodeFrame(EngineUpFrameSchema, { kind: "event", seq: 0, event: OK_EVENT }), "event").seq, 0);
  assert.equal(
    expectKind(decodeFrame(EngineUpFrameSchema, {
      kind: "hello",
      pid: 4321,
      protocol: ENGINE_RPC_VERSION,
      node: "v24.0.0",
      electron: "33.0.0",
    }), "hello").pid,
    4321,
  );
  assert.equal(expectKind(decodeFrame(EngineUpFrameSchema, { kind: "bye", reason: "shutdown" }), "bye").reason, "shutdown");
  assert.equal(expectKind(decodeFrame(EngineUpFrameSchema, { kind: "log", level: "warn", text: "hi" }), "log").level, "warn");
  // hello 的 pid / protocol 必须整数，log 的 level 必须在枚举内
  mustReject(decodeFrame(EngineUpFrameSchema, { kind: "hello", pid: 1.5, protocol: 1, node: "v24" }));
  mustReject(decodeFrame(EngineUpFrameSchema, { kind: "log", level: "debug", text: "hi" }));
});

test("严格解码：cancel / shutdown 下行帧合法，shutdown.reason 默认 quit", () => {
  assert.equal(expectKind(decodeFrame(EngineDownFrameSchema, { kind: "cancel", id: 9 }), "cancel").v, ENGINE_RPC_VERSION);
  assert.equal(expectKind(decodeFrame(EngineDownFrameSchema, { kind: "shutdown", id: 10 }), "shutdown").reason, "quit");
  mustReject(decodeFrame(EngineDownFrameSchema, { kind: "shutdown", id: 10, reason: "restart" }));
  mustReject(decodeFrame(EngineDownFrameSchema, { kind: "cancel", id: -1 }));
});

test("严格解码：v 版本不匹配一律拒绝（帧必须与协议版本同代）", () => {
  for (const raw of [
    { v: ENGINE_RPC_VERSION + 1, kind: "log", level: "info", text: "x" },
    { v: 0, kind: "respond", id: 1, ok: true },
  ]) {
    for (const err of [mustReject(decodeFrame(EngineDownFrameSchema, raw)), mustReject(decodeFrame(EngineUpFrameSchema, raw))]) {
      assert.ok(err.includes("frame="), `错误文本应带上帧摘要：${err}`);
    }
  }
});

test("严格解码：缺 kind、非整数 id、未知方法名一律拒绝", () => {
  const badDown: unknown[] = [
    { id: 1, method: "start" }, // 缺 kind
    { kind: "invoke", method: "start" }, // 缺 id
    { kind: "invoke", id: 1.5, method: "start" }, // 非整数 id
    { kind: "invoke", id: "1", method: "start" }, // 非数字 id
    { kind: "invoke", id: 1, method: "no-such-command" }, // 未知方法名
    { kind: "nope", id: 1 }, // 未知 kind
    null,
    "frame",
    [{ kind: "invoke", id: 1, method: "start" }],
  ];
  for (const raw of badDown) mustReject(decodeFrame(EngineDownFrameSchema, raw));

  const badUp: unknown[] = [
    { kind: "event", seq: 1.5, event: OK_EVENT },
    { kind: "event", event: OK_EVENT }, // 缺 seq
    { kind: "hello", pid: 1, protocol: 1 }, // 缺 node
    { kind: "bye" }, // 缺 reason
  ];
  for (const raw of badUp) mustReject(decodeFrame(EngineUpFrameSchema, raw));
});

test("严格解码：event 帧载荷不符合 EngineEventSchema 时整帧拒绝", () => {
  mustReject(decodeFrame(EngineUpFrameSchema, { kind: "event", seq: 1, event: { type: "totally_new" } }));
  // permission_granted 缺必填字段同样拒绝（载荷已收紧）
  mustReject(decodeFrame(EngineUpFrameSchema, { kind: "event", seq: 2, event: { type: "permission_granted" } }));
  assert.equal(
    expectKind(
      decodeFrame(EngineUpFrameSchema, { kind: "event", seq: 2, event: { type: "unknown", originalType: "x" } }),
      "event",
    ).kind,
    "event",
  );
});

test("跨方向隔离：上行专属帧不能作为下行帧解码", () => {
  for (const raw of [
    { kind: "event", seq: 1, event: OK_EVENT },
    { kind: "hello", pid: 1, protocol: 1, node: "v24" },
    { kind: "bye", reason: "quit" },
    { kind: "log", level: "info", text: "x" },
  ]) {
    mustReject(decodeFrame(EngineDownFrameSchema, raw));
  }
});

test("跨方向隔离：下行专属帧不能作为上行帧解码", () => {
  mustReject(decodeFrame(EngineUpFrameSchema, { kind: "cancel", id: 1 }));
  mustReject(decodeFrame(EngineUpFrameSchema, { kind: "shutdown", id: 1, reason: "quit" }));
});

test("跨方向隔离：invoke 的 method 取值域上下行互斥", () => {
  mustReject(decodeFrame(EngineUpFrameSchema, { kind: "invoke", id: 1, method: "start" }));
  mustReject(decodeFrame(EngineDownFrameSchema, { kind: "invoke", id: 1, method: "host:ui" }));
  assert.equal(
    expectKind(
      decodeFrame(EngineUpFrameSchema, {
        kind: "invoke",
        id: 1,
        method: "host:ui",
        params: { op: "notify", message: "x" },
      }),
      "invoke",
    ).method,
    "host:ui",
  );
});

test("decodeFrameLoose：热路径只做结构哨兵，未知 event 载荷照样放行", () => {
  const loose = decodeFrameLoose({ kind: "event", seq: 1, event: { type: "pi_v0_85_new_event" } });
  assert.notEqual(loose, null);
  assert.equal((loose as { kind?: string }).kind, "event");
  // 同一帧走严格解码必须失败 —— 这就是热路径与单测路径的分工
  mustReject(decodeFrame(EngineUpFrameSchema, { kind: "event", seq: 1, event: { type: "pi_v0_85_new_event" } }));
  // 松解码原样透传同一引用（热路径不拷贝，也不补 v 默认值）
  const raw = { kind: "log", level: "info", text: "x" };
  assert.equal(decodeFrameLoose(raw), raw);
  assert.equal((decodeFrameLoose(raw) as { v?: unknown }).v, undefined);
});

test("decodeFrameLoose：结构畸形一律返回 null，绝不抛异常", () => {
  const bad: unknown[] = [
    null,
    undefined,
    42,
    "invoke",
    [], // 数组没有 kind
    [{ kind: "log" }],
    { kind: "wat", id: 1 }, // 未知 kind
    { kind: "invoke", method: "start" }, // invoke 缺数字 id
    { kind: "invoke", id: "1", method: "start" },
    { kind: "invoke", id: 1 }, // invoke 缺字符串 method
    { kind: "respond", id: 1 }, // respond 缺布尔 ok
    { kind: "respond", id: 1, ok: "yes" },
    { kind: "respond", ok: true }, // respond 缺数字 id
    { kind: "event", event: OK_EVENT }, // event 缺数字 seq
    { kind: "event", seq: "1", event: OK_EVENT },
    { kind: "event", seq: 1 }, // event 缺对象载荷
    { kind: "event", seq: 1, event: null },
    { kind: "event", seq: 1, event: "x" },
    { kind: "cancel" }, // cancel 缺数字 id
    { kind: "shutdown" }, // shutdown 缺数字 id
  ];
  for (const raw of bad) assert.equal(decodeFrameLoose(raw), null, `应返回 null：${String(JSON.stringify(raw))}`);

  // 结构合格的帧（上下行两侧都算）一律放行：method 名与载荷都不查表
  for (const raw of [
    { kind: "invoke", id: 1, method: "whatever" },
    { kind: "respond", id: 1, ok: false },
    { kind: "event", seq: 1, event: {} },
    { kind: "hello" },
    { kind: "bye" },
    { kind: "cancel", id: 2 },
    { kind: "shutdown", id: 3 },
  ]) {
    assert.notEqual(decodeFrameLoose(raw), null);
  }
});

test("nextFrameId 从 1 起严格自增，0 永不复用", () => {
  resetFrameIdForTest(0);
  const firstRun = [nextFrameId(), nextFrameId(), nextFrameId()];
  assert.deepEqual(firstRun, [1, 2, 3]);
  resetFrameIdForTest(41); // 重置后序列可复现
  assert.deepEqual([nextFrameId(), nextFrameId()], [42, 43]);
  for (const id of firstRun.concat([42, 43])) assert.ok(Number.isInteger(id) && id > 0);
});

test("makeInvoke / makeRespond / makeEvent 产出的帧可克隆并能严格解码", () => {
  resetFrameIdForTest(0);
  // 真实传输是 utilityProcess 的 structuredClone；本包 tsconfig 只装 ES2023 lib，故显式取全局
  const clone = (globalThis as unknown as { structuredClone: <T>(x: T) => T }).structuredClone;

  const down = clone(makeInvoke("prompt", { text: "你好" }));
  assert.equal(down.id, 1);
  assert.equal(expectKind(decodeFrame(EngineDownFrameSchema, down), "invoke").method, "prompt");
  const upInvoke = clone(makeInvoke("host:approval", { ticket: "t1", toolName: "edit" }));
  assert.equal(expectKind(decodeFrame(EngineUpFrameSchema, upInvoke), "invoke").method, "host:approval");

  const respond = clone(makeRespond(2, true, { sessionId: "s1" }));
  assert.equal(expectKind(decodeFrame(EngineUpFrameSchema, respond), "respond").ok, true);
  const failed = clone(makeRespond(3, false, undefined, "引擎崩了"));
  assert.equal(expectKind(decodeFrame(EngineDownFrameSchema, failed), "respond").error, "引擎崩了");

  const event = clone(makeEvent(4, OK_EVENT));
  assert.equal(event.v, ENGINE_RPC_VERSION);
  assert.equal(expectKind(decodeFrame(EngineUpFrameSchema, event), "event").seq, 4);
  assert.equal(nextFrameId(), 3); // 只有 makeInvoke 省略 id 时才消耗自增序列
});

test("frameErrorText：Error / 字符串 / 普通对象都翻成字符串", () => {
  assert.equal(frameErrorText(new Error("连接断开")), "连接断开");
  class EngineFailure extends Error {
    override name = "EngineFailure";
  }
  assert.equal(frameErrorText(new EngineFailure("")), "EngineFailure"); // 空 message 退回 name
  assert.equal(frameErrorText("纯字符串"), "纯字符串");
  assert.equal(frameErrorText({ code: "ENOENT", retry: false }), '{"code":"ENOENT","retry":false}');
});

test("frameErrorText：循环引用对象不抛异常（JSON.stringify 会炸）", () => {
  const cyclic: Record<string, unknown> = { name: "pi" };
  cyclic.self = cyclic;
  const text = frameErrorText(cyclic);
  assert.equal(typeof text, "string");
  assert.ok(text.length > 0);
});

test("acceptSeq：只认预期下一帧，丢帧计数不静默", () => {
  assert.deepEqual(acceptSeq(5, 6), { ok: true, dropped: 0 });
  assert.deepEqual(acceptSeq(0, 1), { ok: true, dropped: 0 });
  assert.deepEqual(acceptSeq(1, 5), { ok: false, dropped: 3 });
});

test("acceptSeq：重复/乱序帧 dropped 记 0，游标不因返回值回退", () => {
  assert.deepEqual(acceptSeq(7, 7), { ok: false, dropped: 0 }); // 重复帧
  assert.deepEqual(acceptSeq(7, 3), { ok: false, dropped: 0 }); // 迟到帧（不得为负）
  let last = 7;
  for (const seq of [7, 3, 6]) {
    const r = acceptSeq(last, seq);
    assert.equal(r.ok, false);
    assert.equal(r.dropped, 0);
    if (r.ok) last = seq; // 消费侧只在 ok 时推进游标
  }
  assert.equal(last, 7);
});

test("validateRpcParams：每个下行方法都有参数 schema（新增方法漏配即失败）", () => {
  for (const method of ENGINE_RPC_METHODS) {
    assert.ok(Object.hasOwn(ENGINE_RPC_PARAM_SCHEMAS, method), `${method} 缺少参数 schema`);
    assert.ok(ENGINE_RPC_PARAM_SCHEMAS[method], `${method} 的参数 schema 为空`);
  }
  assert.equal(Object.keys(ENGINE_RPC_PARAM_SCHEMAS).length, ENGINE_RPC_METHODS.length);
});

test("validateRpcParams：start 必填 projectDir 且补齐数组默认值", () => {
  mustRejectParams(validateRpcParams("start", { agentDir: "/tmp/a" }));
  mustRejectParams(validateRpcParams("start", { projectDir: "" })); // min(1)
  const res = validateRpcParams("start", { projectDir: "/tmp/p" });
  if (!res.ok) throw new Error(`应通过：${res.error}`);
  const value = res.value as { projectDir: string; hostToolNames: unknown[]; additionalExtensionPaths: unknown[] };
  assert.equal(value.projectDir, "/tmp/p");
  assert.deepEqual(value.hostToolNames, []);
  assert.deepEqual(value.additionalExtensionPaths, []);
});

test("validateRpcParams：prompt 需非空 text，steer/followUp 只需 text", () => {
  mustRejectParams(validateRpcParams("prompt", { text: "" }));
  mustRejectParams(validateRpcParams("prompt", {}));
  // attachments 有 12 个的上限
  mustRejectParams(
    validateRpcParams("prompt", { text: "x", attachments: Array.from({ length: 13 }, (_, i) => `f${i}`) }),
  );
  assert.equal(validateRpcParams("prompt", { text: "继续" }).ok, true);
  assert.equal(validateRpcParams("steer", { text: "换个思路" }).ok, true);
  assert.equal(validateRpcParams("followUp", { text: "补充一句" }).ok, true);
});

test("validateRpcParams：setModel 需 provider 与 modelId 双必填", () => {
  mustRejectParams(validateRpcParams("setModel", { provider: "anthropic" }));
  mustRejectParams(validateRpcParams("setModel", { modelId: "claude" }));
  mustRejectParams(validateRpcParams("setModel", { provider: "", modelId: "claude" }));
  mustRejectParams(validateRpcParams("setModel", undefined));
  assert.equal(validateRpcParams("setModel", { provider: "anthropic", modelId: "claude-x" }).ok, true);
});

test("validateRpcParams：fork 的 position 只认 before / at", () => {
  assert.equal(validateRpcParams("fork", { entryId: "e1", position: "before" }).ok, true);
  assert.equal(validateRpcParams("fork", { entryId: "e1", position: "at" }).ok, true);
  mustRejectParams(validateRpcParams("fork", { entryId: "e1", position: "after" }));
  mustRejectParams(validateRpcParams("fork", { position: "at" }));
});

test("validateRpcParams：无参命令接受 undefined", () => {
  for (const method of [
    "abort",
    "reload",
    "getState",
    "getSessionId",
    "getRuntimeInfo",
    "listCommands",
    "getAvailableModels",
    "getAvailableThinkingLevels",
    "shutdown",
  ] as const) {
    assert.equal(validateRpcParams(method, undefined).ok, true, `${method} 应接受空参数`);
  }
  assert.equal(validateRpcParams("abort", { anything: 1 }).ok, true); // VOID_PARAMS = z.unknown()
});

test("validateRpcParams：未知方法名一律拒绝并给出中文错误", () => {
  for (const method of ["host:ui", "no-such-command", "", 42, null, undefined]) {
    const res = validateRpcParams(method, {});
    if (res.ok) throw new Error(`${String(method)} 不应被接受`);
    assert.ok(res.error.includes("未知引擎命令"), res.error);
  }
});

test("类型守卫：下行方法与反向方法各自只认自己的名字", () => {
  assert.ok(isEngineRpcMethod("start"));
  assert.ok(isEngineRpcMethod("stats"));
  assert.ok(isEngineReverseRpcMethod("host:ui"));
  assert.ok(isEngineReverseRpcMethod("host:tool-execute"));
  for (const m of ENGINE_REVERSE_METHODS) assert.equal(isEngineRpcMethod(m), false, `${m} 不是下行方法`);
  for (const m of ENGINE_RPC_METHODS) assert.equal(isEngineReverseRpcMethod(m), false, `${m} 不是反向方法`);
  for (const m of [null, undefined, 1, {}, [], "start "]) {
    assert.equal(isEngineRpcMethod(m), false);
    assert.equal(isEngineReverseRpcMethod(m), false);
  }
});
