/**
 * pi-wood 桌面扩展 API（方案 §5.8 / §6）。
 *
 * 三方共用：
 * - 插件进程：`createDesktopApi(process.parentPort)` 得到 `pi` 对象（真实 TS 插件用）。
 * - 主进程 PluginHost：用 `API_PERMISSIONS` / `SENSITIVE_METHODS` 做权限门（单一事实源）。
 * - 渲染层：`PluginStatus` 等展示类型。
 *
 * 本文件（含 manifest.ts）不 import electron/node，保持零依赖，可安全静态打进 CJS 主进程 bundle
 * （与 ESM-only 的 Pi SDK 不同——见 §8：第一方纯类型/数据包不受 ERR_PACKAGE_PATH_NOT_EXPORTED 约束）。
 */
import type { PanelDefinition, PluginPermission, StatusItem } from "./manifest.ts";

export * from "./manifest.ts";

// ---------- §5.8 桌面扩展 API（超集）----------

export interface DesktopApi {
  panels: {
    register(def: PanelDefinition): Promise<void>;
    open(id: string, params?: unknown): Promise<void>;
    close(id: string): Promise<void>;
  };
  statusbar: {
    setItem(id: string, def: StatusItem): Promise<void>;
    remove(id: string): Promise<void>;
  };
  editor: {
    openFile(path: string, opts?: { focus?: boolean }): Promise<void>;
  };
  terminal: {
    run(cmd: string, opts?: { cwd?: string; newTab?: boolean }): Promise<number>;
  };
  browser: {
    navigate(url: string): Promise<void>;
    goBack(): Promise<void>;
    screenshot(): Promise<string>;
  };
  diff: {
    show(beforePath: string, afterPath: string): Promise<void>;
    revert(file: string): Promise<void>;
  };
  notify: (opts: {
    title: string;
    body?: string;
    kind?: "info" | "success" | "warning" | "error";
  }) => void;
  ui: {
    confirm(opts: { title: string; body: string }): Promise<boolean>;
    select<T>(opts: { title?: string; options: T[]; render?: (t: T) => string }): Promise<T | null>;
    input(opts: { title?: string; prompt: string; defaultValue?: string }): Promise<string | null>;
  };
  bus: {
    publish(topic: string, payload: unknown): Promise<void>;
    subscribe(topic: string, fn: (p: unknown) => void): () => void;
  };
  window: {
    setTitle(title: string): Promise<void>;
    setProgress(progress: number | null): Promise<void>;
  };
  invokeAgentTool(name: string, args: unknown): Promise<unknown>;
  getPermissions(): Promise<PluginPermission[]>;
}

// ---------- 进程间消息帧（插件 ⇄ 主进程，经 parentPort/postMessage）----------

/** 插件 → 主进程 */
export type PluginToHost =
  | { type: "ready"; name: string }
  | { type: "invoke"; id: number; method: string; args: unknown[] }
  | { type: "log"; level: "info" | "warning" | "error"; text: string };

/** 主进程 → 插件 */
export type HostToPlugin =
  | { type: "result"; id: number; ok: boolean; value?: unknown; error?: string }
  | { type: "event"; topic: string; payload: unknown }
  | /** 宿主在激活/演示时向插件下发的控制消息（非 DesktopApi 的一部分） */
  { type: "control"; name: string; args?: unknown };

// ---------- 权限门：方法 → 所需权限（单一事实源） ----------

/**
 * 每个可被插件调用的方法对应一个所需权限；`null` 表示无需权限（安全或自省）。
 * 未列出的方法名视为「未知方法」，宿主直接拒绝（防未来加方法忘了配权限）。
 */
export const API_PERMISSIONS: Record<string, PluginPermission | null> = {
  "panels.register": "panels",
  "panels.open": "panels",
  "panels.close": "panels",
  "statusbar.setItem": "statusbar",
  "statusbar.remove": "statusbar",
  "editor.openFile": "editor:open",
  "terminal.run": "terminal:run",
  "browser.navigate": "browser:navigate",
  "browser.goBack": "browser:navigate",
  "browser.screenshot": "browser:navigate",
  "diff.show": "editor:open",
  "diff.revert": "fs:write",
  notify: "notify",
  "ui.confirm": null,
  "ui.select": null,
  "ui.input": null,
  "bus.publish": "bus:*",
  "bus.subscribe": "bus:*",
  "window.setTitle": "window:control",
  "window.setProgress": "window:control",
  invokeAgentTool: "agentTool:invoke",
  getPermissions: null,
};

/**
 * 敏感方法：即使已声明权限，首次调用仍弹运行时确认（§6.2「运行时提示」）。
 * 主进程按 (插件 id + 方法) 记忆已授予，会话内不重复打扰。
 */
export const SENSITIVE_METHODS: ReadonlySet<string> = new Set([
  "terminal.run",
  "diff.revert",
  "invokeAgentTool",
]);

export type GateOutcome =
  | { ok: true; needRuntimeConfirm: boolean }
  | { ok: false; reason: string };

/**
 * 纯函数权限裁决：供宿主（PluginHost）与单测共用。
 * @param method   被调方法名，如 "terminal.run"
 * @param declared manifest 声明的权限集合
 */
export function checkPermission(method: string, declared: readonly PluginPermission[]): GateOutcome {
  if (!Object.prototype.hasOwnProperty.call(API_PERMISSIONS, method)) {
    return { ok: false, reason: `未知 API：${method}` };
  }
  const required = API_PERMISSIONS[method] as PluginPermission | null;
  if (required === null) {
    return { ok: true, needRuntimeConfirm: false };
  }
  if (!declared.includes(required)) {
    return { ok: false, reason: `未声明权限「${required}」，API ${method} 被拒绝` };
  }
  return { ok: true, needRuntimeConfirm: SENSITIVE_METHODS.has(method) };
}

// ---------- 客户端桥（真实 TS 插件用；示例 .cjs 各自内联等价实现） ----------

/** 传输端口抽象：Electron utilityProcess 下即 process.parentPort。 */
export interface PluginClientPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (e: { data: unknown }) => void): void;
}

/**
 * 把一个 parentPort 包装成 §5.8 的 `DesktopApi`。所有能力都转成 invoke 帧发往宿主，
 * 宿主完成权限门与实际执行后按 id 回 result。bus.subscribe 本地登记、收 event 帧回调。
 */
export function createDesktopApi(port: PluginClientPort): DesktopApi {
  let seq = 0;
  const pending = new Map<number, (r: Extract<HostToPlugin, { type: "result" }>) => void>();
  const busHandlers = new Map<string, Set<(p: unknown) => void>>();

  port.on("message", (e) => {
    const msg = e.data as HostToPlugin;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "result") {
      const cb = pending.get(msg.id);
      if (cb) {
        pending.delete(msg.id);
        cb(msg);
      }
    } else if (msg.type === "event") {
      const set = busHandlers.get(msg.topic);
      if (set) for (const fn of set) {
        try {
          fn(msg.payload);
        } catch {
          /* 订阅者抛错不影响其它订阅者 */
        }
      }
    }
  });

  const call = (method: string, args: unknown[]): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, (r) => {
        if (r.ok) resolve(r.value);
        else reject(new Error(r.error ?? `plugin api 调用失败：${method}`));
      });
      port.postMessage({ type: "invoke", id, method, args } satisfies PluginToHost);
    });
  // fire-and-forget（notify 语义为 void；权限拒绝由宿主侧记录日志）
  const fire = (method: string, args: unknown[]): void => {
    const id = ++seq;
    port.postMessage({ type: "invoke", id, method, args } satisfies PluginToHost);
  };
  const pvoid = (m: string, a: unknown[]): Promise<void> => call(m, a).then(() => undefined);

  return {
    panels: {
      register: (def) => pvoid("panels.register", [def]),
      open: (id, params) => pvoid("panels.open", [id, params]),
      close: (id) => pvoid("panels.close", [id]),
    },
    statusbar: {
      setItem: (id, def) => pvoid("statusbar.setItem", [id, def]),
      remove: (id) => pvoid("statusbar.remove", [id]),
    },
    editor: {
      openFile: (path, opts) => pvoid("editor.openFile", [path, opts]),
    },
    terminal: {
      run: (cmd, opts) => call("terminal.run", [cmd, opts]) as Promise<number>,
    },
    browser: {
      navigate: (url) => pvoid("browser.navigate", [url]),
      goBack: () => pvoid("browser.goBack", []),
      screenshot: () => call("browser.screenshot", []) as Promise<string>,
    },
    diff: {
      show: (beforePath, afterPath) => pvoid("diff.show", [beforePath, afterPath]),
      revert: (file) => pvoid("diff.revert", [file]),
    },
    notify: (opts) => fire("notify", [opts]),
    ui: {
      confirm: (opts) => call("ui.confirm", [opts]) as Promise<boolean>,
      select: <T,>(opts: { options: T[] }) => call("ui.select", [opts]) as Promise<T | null>,
      input: (opts) => call("ui.input", [opts]) as Promise<string | null>,
    },
    bus: {
      publish: (topic, payload) => pvoid("bus.publish", [topic, payload]),
      subscribe: (topic, fn) => {
        let set = busHandlers.get(topic);
        if (!set) {
          set = new Set();
          busHandlers.set(topic, set);
        }
        set.add(fn);
        return () => {
          set?.delete(fn);
        };
      },
    },
    window: {
      setTitle: (title) => pvoid("window.setTitle", [title]),
      setProgress: (progress) => pvoid("window.setProgress", [progress]),
    },
    invokeAgentTool: (name, args) => call("invokeAgentTool", [name, args]),
    getPermissions: () => call("getPermissions", []) as Promise<PluginPermission[]>,
  };
}
