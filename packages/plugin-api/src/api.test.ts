import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkPermission,
  createDesktopApi,
  type HostToPlugin,
  type PluginClientPort,
  type PluginToHost,
} from "./index.ts";

// ---------- checkPermission（纯函数权限门） ----------

test("checkPermission: 未声明所需权限 → 拒绝", () => {
  const r = checkPermission("terminal.run", ["notify", "editor:open"]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /terminal:run/);
});

test("checkPermission: 已声明 → 放行且敏感方法需运行时确认", () => {
  const r = checkPermission("terminal.run", ["terminal:run"]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.needRuntimeConfirm, true);
});

test("checkPermission: 非敏感方法声明即静默放行", () => {
  const r = checkPermission("notify", ["notify"]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.needRuntimeConfirm, false);
});

test("checkPermission: 无需权限的方法（ui.confirm/getPermissions）", () => {
  assert.equal(checkPermission("ui.confirm", []).ok, true);
  assert.equal(checkPermission("getPermissions", []).ok, true);
});

test("checkPermission: 未知方法拒绝", () => {
  const r = checkPermission("panels.doesNotExist", ["panels"]);
  assert.equal(r.ok, false);
});

// ---------- createDesktopApi（客户端桥） ----------

function makePort(): {
  port: PluginClientPort;
  sent: PluginToHost[];
  deliver: (msg: HostToPlugin) => void;
} {
  const sent: PluginToHost[] = [];
  let msgCb: ((e: { data: unknown }) => void) | undefined;
  const port: PluginClientPort = {
    postMessage: (m) => sent.push(m as PluginToHost),
    on: (_e, cb) => {
      msgCb = cb;
    },
  };
  return {
    port,
    sent,
    deliver: (msg) => msgCb?.({ data: msg }),
  };
}

test("createDesktopApi: notify 为 fire-and-forget，发 invoke 帧且 method 正确", () => {
  const { port, sent } = makePort();
  const pi = createDesktopApi(port);
  pi.notify({ title: "hi", kind: "info" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.type, "invoke");
  if (sent[0]?.type === "invoke") {
    assert.equal(sent[0].method, "notify");
    assert.deepEqual(sent[0].args, [{ title: "hi", kind: "info" }]);
  }
});

test("createDesktopApi: invoke 帧 → result 帧按 id 解析", async () => {
  const { port, sent, deliver } = makePort();
  const pi = createDesktopApi(port);
  const p = pi.getPermissions();
  const frame = sent.find((s) => s.type === "invoke");
  if (!frame || frame.type !== "invoke") throw new Error("expected an invoke frame");
  deliver({ type: "result", id: frame.id, ok: true, value: ["notify", "panels"] });
  assert.deepEqual(await p, ["notify", "panels"]);
});

test("createDesktopApi: result ok:false → reject", async () => {
  const { port, sent, deliver } = makePort();
  const pi = createDesktopApi(port);
  const p = pi.terminal.run("ls");
  const frame = sent.find((s) => s.type === "invoke");
  if (!frame || frame.type !== "invoke") throw new Error("expected an invoke frame");
  deliver({ type: "result", id: frame.id, ok: false, error: "denied: terminal:run" });
  await assert.rejects(p, /terminal:run/);
});

test("createDesktopApi: bus.subscribe 收 event 帧回调、取消订阅后不再触发", () => {
  const { port, deliver } = makePort();
  const pi = createDesktopApi(port);
  const seen: unknown[] = [];
  const off = pi.bus.subscribe("x", (p) => seen.push(p));
  deliver({ type: "event", topic: "x", payload: 1 });
  off();
  deliver({ type: "event", topic: "x", payload: 2 });
  assert.deepEqual(seen, [1]);
});

test("createDesktopApi: 多帧 id 递增、互不串台", async () => {
  const { port, sent, deliver } = makePort();
  const pi = createDesktopApi(port);
  const a = pi.window.setTitle("A");
  const b = pi.window.setProgress(0.5);
  const frames = sent.filter((s): s is Extract<PluginToHost, { type: "invoke" }> => s.type === "invoke");
  assert.equal(frames.length, 2);
  assert.notEqual(frames[0]?.id, frames[1]?.id);
  deliver({ type: "result", id: frames[0]!.id, ok: true });
  deliver({ type: "result", id: frames[1]!.id, ok: true });
  await Promise.all([a, b]);
});
