'use strict';
/**
 * pi-wood 插件客户端引导（纯 CommonJS，零依赖）。
 *
 * 这是 @pi-wood/plugin-api 里 createDesktopApi 的 JS 等价实现——示例插件用 .cjs 跑在
 * Electron utilityProcess 里，不便 require TS workspace 包，故内联一份同构桥。
 * 真实 TS 插件应 `import { createDesktopApi } from "@pi-wood/plugin-api"`。
 *
 * 用法：const { bootstrap } = require('../_pi-client.cjs');
 *        bootstrap({ onActivate(api){...}, onControl(name, args, api){...} });
 */
const pp = process.parentPort;

function createDesktopApi() {
  let seq = 0;
  const pending = new Map();
  const subs = new Map();

  pp.on("message", (e) => {
    const msg = e && e.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "result") {
      const cb = pending.get(msg.id);
      if (cb) {
        pending.delete(msg.id);
        cb(msg);
      }
    } else if (msg.type === "event") {
      const set = subs.get(msg.topic);
      if (set) for (const fn of set) {
        try {
          fn(msg.payload);
        } catch (_) {
          /* 订阅者抛错忽略 */
        }
      }
    }
  });

  function call(method, args) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, (r) => (r.ok ? resolve(r.value) : reject(new Error(r.error || "api " + method + " failed"))));
      pp.postMessage({ type: "invoke", id, method, args: args || [] });
    });
  }
  function fire(method, args) {
    pp.postMessage({ type: "invoke", id: ++seq, method, args: args || [] });
  }
  const v = (m, a) => call(m, a).then(() => undefined);

  return {
    panels: { register: (d) => v("panels.register", [d]), open: (id, p) => v("panels.open", [id, p]), close: (id) => v("panels.close", [id]) },
    statusbar: { setItem: (id, d) => v("statusbar.setItem", [id, d]), remove: (id) => v("statusbar.remove", [id]) },
    editor: { openFile: (p, o) => v("editor.openFile", [p, o]) },
    terminal: { run: (c, o) => call("terminal.run", [c, o]) },
    browser: { navigate: (u) => v("browser.navigate", [u]), goBack: () => v("browser.goBack", []), screenshot: () => call("browser.screenshot", []) },
    diff: { show: (b, a) => v("diff.show", [b, a]), revert: (f) => v("diff.revert", [f]) },
    notify: (o) => fire("notify", [o]),
    ui: { confirm: (o) => call("ui.confirm", [o]), select: (o) => call("ui.select", [o]), input: (o) => call("ui.input", [o]) },
    bus: {
      publish: (t, p) => v("bus.publish", [t, p]),
      subscribe: (t, fn) => {
        let set = subs.get(t);
        if (!set) {
          set = new Set();
          subs.set(t, set);
        }
        set.add(fn);
        return () => set.delete(fn);
      },
    },
    window: { setTitle: (t) => v("window.setTitle", [t]), setProgress: (p) => v("window.setProgress", [p]) },
    invokeAgentTool: (n, a) => call("invokeAgentTool", [n, a]),
    getPermissions: () => call("getPermissions", []),
  };
}

function bootstrap(handlers) {
  handlers = handlers || {};
  const api = createDesktopApi();
  // 控制消息（crash / overreach 等）另挂一个监听，与上面的 result/event 互不干扰
  pp.on("message", (e) => {
    const m = e && e.data;
    if (m && m.type === "control" && handlers.onControl) handlers.onControl(m.name, m.args, api);
  });
  pp.postMessage({ type: "ready", name: process.env.PIWOOD_PLUGIN_ID || "" });
  setImmediate(() => {
    if (handlers.onActivate) handlers.onActivate(api);
  });
}

module.exports = { createDesktopApi, bootstrap };
