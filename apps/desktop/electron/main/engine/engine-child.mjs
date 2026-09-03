/**
 * T8.0 P1 探针子进程入口 —— 验证「Pi 引擎能否活在没有 window 的 utilityProcess 里」。
 *
 * ⚠ 故意用独立 `.mjs` 而非 TS 源：utilityProcess.fork 走的是 Node 模块加载，
 *   必须能直接被 Node 解析（Pi SDK 是 ESM-only，desktop 已 type:module → 本文件即 ESM）。
 *   **不打进 out/main bundle**（同子代理扩展入口的处置），路径解析形态正是 P1-d 要测的东西。
 *
 * 帧协议（双向，结构化克隆）：
 *   { kind: 'invoke',  id, method, args }   任一侧发起 RPC
 *   { kind: 'respond', id, ok, value, error }
 *   { kind: 'event',   topic, payload }     单向事件（ready/engine/milestone/log/bye）
 *   { kind: 'cancel',  id }                 取消在跑的 invoke（探针用：验 abort 可达）
 *   { kind: 'control', name }               无应答控制（crash）
 *
 * 用法：由 electron/main/engine/engine-process-probe.ts fork，勿手工运行。
 */
import { performance } from "node:perf_hooks";

const pp = process.parentPort;
if (!pp) {
  console.error("engine-child: 必须经 utilityProcess.fork 启动（无 process.parentPort）");
  process.exit(2);
}

const BOOT = performance.now();
const t = () => Math.round(performance.now() - BOOT);
const post = (m) => {
  try {
    pp.postMessage(m);
  } catch (e) {
    console.error(`post failed (${m?.kind}/${m?.topic}): ${e?.message}`);
  }
};
const event = (topic, payload) => post({ kind: "event", topic, payload });

/** 反向 RPC（child → main）：宿主工具执行、ctx.ui 往返都走这条 */
let seq = 0;
const pending = new Map();
function rpc(method, args, timeoutMs = 30_000) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`reverse-rpc 超时 ${method} (${timeoutMs}ms)`));
    }, timeoutMs);
    pending.set(id, (r) => {
      clearTimeout(timer);
      r.ok ? resolve(r.value) : reject(new Error(r.error ?? `reverse-rpc 失败 ${method}`));
    });
    post({ kind: "invoke", id, method, args });
  });
}

const mem = () => {
  const m = process.memoryUsage();
  return { rssMB: Math.round(m.rss / 1e6), heapMB: Math.round(m.heapUsed / 1e6), extMB: Math.round(m.external / 1e6) };
};

/* ---------------- 引擎装配（P1-a 主体） ---------------- */

const S = {
  pi: null,
  services: null,
  runtime: null,
  session: null,
  unsubscribe: null,
  hostToolHits: [], // 宿主反向工具被调记录
  uiHits: [], // ctx.ui 往返记录
  eventCount: 0,
  firstEventAt: 0,
  bound: false,
};

/** 桌面 ctx.ui 的探针版：阻塞类成员反向 RPC 回主进程，其余 no-op（结构对齐 sdk-adapter） */
function makeUiContext() {
  const noop = () => {};
  const theme = new Proxy((...a) => String(a[a.length - 1] ?? ""), {
    apply: (_t, _s, a) => String(a[a.length - 1] ?? ""),
    get: (_t, p) => (typeof p === "symbol" ? undefined : theme),
  });
  const base = {
    notify: (message, type) => {
      S.uiHits.push({ m: "notify", message: String(message).slice(0, 80), type: type ?? "info" });
      return rpc("ui:notify", { message, type });
    },
    select: (title, options) => {
      S.uiHits.push({ m: "select", title: String(title).slice(0, 80), n: options?.length ?? 0 });
      return rpc("ui:select", { title, options });
    },
    confirm: (title, message) => {
      S.uiHits.push({ m: "confirm", title: String(title).slice(0, 80) });
      return rpc("ui:confirm", { title, message }).then((v) => Boolean(v));
    },
    input: (title, placeholder) => {
      S.uiHits.push({ m: "input", title: String(title).slice(0, 80) });
      return rpc("ui:input", { title, placeholder });
    },
    custom: async () => undefined,
    editor: async () => undefined,
    onTerminalInput: () => () => {},
    setStatus: noop,
    setWorkingMessage: noop,
    setWorkingVisible: noop,
    setWorkingIndicator: noop,
    setHiddenThinkingLabel: noop,
    setWidget: noop,
    setFooter: noop,
    setHeader: noop,
    setTitle: noop,
    pasteToEditor: noop,
    setEditorText: noop,
    getEditorText: () => "",
    addAutocompleteProvider: noop,
    setEditorComponent: noop,
    getEditorComponent: () => undefined,
    getToolsExpanded: () => false,
    setToolsExpanded: noop,
    getAllThemes: () => [],
    getTheme: () => theme,
    setTheme: () => ({ success: false, error: "探针子进程不支持切换主题" }),
    theme,
  };
  return new Proxy(base, {
    get(target, prop, recv) {
      if (prop in target) return Reflect.get(target, prop, recv);
      if (typeof prop === "symbol" || ["then", "catch", "finally", "toJSON", "constructor", "inspect", "nodeType"].includes(prop)) return undefined;
      return () => undefined;
    },
  });
}

/**
 * 宿主实现的 customTool：execute 里反向 RPC 回主进程取值。
 * 这是「引擎进子进程后，9 个桌面 customTool 仍须由宿主实现」这条架构约束的最小可行验证。
 */
function probeCustomTools() {
  return [
    {
      name: "probe_host_echo",
      label: "探针宿主回显",
      description: "探针专用：把入参交给宿主（主进程）执行并回传，验证 child→main 反向工具链路",
      // 不依赖 typebox（子进程入口保持零 workspace 依赖）：手写最小 JSON Schema
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      async execute(_id, params) {
        const value = await rpc("tool:execute", { name: "probe_host_echo", params });
        S.hostToolHits.push({ at: t(), text: String(params?.text ?? "").slice(0, 60) });
        return { content: [{ type: "text", text: `host:${value}` }], details: { ok: true } };
      },
    },
  ];
}

async function ensurePi() {
  if (S.pi) return S.pi;
  const t0 = performance.now();
  S.pi = await import("@earendil-works/pi-coding-agent");
  event("milestone", { what: "sdk-import", ms: Math.round(performance.now() - t0), at: t(), mem: mem() });
  return S.pi;
}

/** 装配一套 services + session + runtime 并 bindExtensions（等价 SdkAdapter.start） */
async function boot(tag) {
  const pi = await ensurePi();
  const cwd = process.env.PIWOOD_PROBE_CWD || process.cwd();
  const agentDir = pi.getAgentDir();

  const t1 = performance.now();
  const services = await pi.createAgentSessionServices({ cwd, agentDir });
  const servicesMs = Math.round(performance.now() - t1);

  const t2 = performance.now();
  const factory = async (opts) => {
    const s = opts === undefined ? services : await pi.createAgentSessionServices({ cwd: opts.cwd, agentDir: opts.agentDir });
    const r = await pi.createAgentSessionFromServices({
      services: s,
      sessionManager: opts.sessionManager,
      customTools: probeCustomTools(),
    });
    return { session: r.session, services: s };
  };
  const runtime = await pi.createAgentSessionRuntime(factory, {
    cwd,
    agentDir,
    sessionManager: pi.SessionManager.create(cwd),
  });
  const sessionMs = Math.round(performance.now() - t2);

  const t3 = performance.now();
  await runtime.session.bindExtensions({ uiContext: makeUiContext(), mode: "rpc" });
  const bindMs = Math.round(performance.now() - t3);
  S.bound = true;

  S.services = services;
  S.runtime = runtime;
  S.session = runtime.session;
  S.unsubscribe = S.session.subscribe((raw) => {
    S.eventCount += 1;
    if (!S.firstEventAt) S.firstEventAt = t();
    const type = raw?.type ?? raw?.event?.type ?? "unknown";
    // 只回传类型与长度，避免把整段 token 流灌进 IPC（探针不需要真内容）
    const len = typeof raw?.text === "string" ? raw.text.length : typeof raw?.delta === "string" ? raw.delta.length : undefined;
    event("engine", { type, len, at: t() });
  });

  const ext = services.resourceLoader?.getExtensions?.() ?? {};
  const tools = S.session.getActiveToolNames?.() ?? [];
  const diagnostics = [...(runtime.diagnostics ?? []), ...(Array.isArray(ext.errors) ? ext.errors : [])];
  return {
    tag,
    cwd,
    agentDir,
    sessionId: S.session.sessionId,
    servicesMs,
    sessionMs,
    bindMs,
    bootMs: t(),
    tools,
    toolCount: tools.length,
    extensionNames: (ext.extensions ?? []).map((e) => e?.name ?? e?.path ?? "?").slice(0, 40),
    extensionCount: (ext.extensions ?? []).length,
    skills: (services.resourceLoader?.getSkills?.()?.skills ?? []).map((s) => s?.name ?? "?").slice(0, 20),
    diagnostics: diagnostics.map((d) => ({ type: d?.type, message: String(d?.message ?? "").slice(0, 200) })),
    mem: mem(),
  };
}

/* ---------------- 帧处理 ---------------- */

async function handle(m) {
  const { id, method, args } = m;
  const reply = (ok, value, error) => post({ kind: "respond", id, ok, value, error: error ? String(error?.message ?? error) : undefined });
  try {
    switch (method) {
      case "load": {
        reply(true, await boot(args?.tag ?? "c"));
        return;
      }
      case "prompt": {
        const t0 = performance.now();
        const before = S.eventCount;
        await S.session.prompt(String(args?.text ?? ""), {});
        reply(true, { ms: Math.round(performance.now() - t0), eventsDuring: S.eventCount - before, firstEventAt: S.firstEventAt, mem: mem() });
        return;
      }
      case "hostToolDirect": {
        // 不经模型，直接调 customTool.execute —— 稳定验证反向 tool:execute 链路
        const value = await rpc("tool:execute", { name: "probe_host_echo", params: { text: args?.text ?? "ping" } });
        S.hostToolHits.push({ at: t(), text: String(args?.text ?? "").slice(0, 60) });
        reply(true, { value, hits: S.hostToolHits.length });
        return;
      }
      case "uiRoundTrip": {
        const ui = makeUiContext();
        const out = { confirm: await ui.confirm("探针确认", "允许？"), select: await ui.select("探针选择", ["a", "b"]), input: await ui.input("探针输入", "x") };
        reply(true, { ...out, uiHits: S.uiHits.length });
        return;
      }
      case "slowPrompt": {
        // 制造一个可被 cancel 的长任务：真发一轮但立刻由主进程 cancel（验 abort 可达）
        const p = S.session.prompt(String(args?.text ?? "讲一个很长的故事"), {});
        p.then(() => reply(true, { settled: true })).catch((e) => reply(false, undefined, e));
        event("milestone", { what: "slow-prompt-started", at: t() });
        return;
      }
      case "stats": {
        reply(true, { mem: mem(), eventCount: S.eventCount, hostToolHits: S.hostToolHits.length, uiHits: S.uiHits.length, bound: S.bound, pid: process.pid, uptimeMs: t() });
        return;
      }
      case "shutdown": {
        // 关键：走 runtime.dispose()（广播 session_shutdown），而不是 session.dispose()
        const t0 = performance.now();
        let disposeMs = -1;
        try {
          await S.runtime?.dispose?.();
          disposeMs = Math.round(performance.now() - t0);
        } catch (e) {
          event("log", { level: "warn", text: `runtime.dispose 抛错：${e?.message}` });
        }
        S.unsubscribe?.();
        reply(true, { disposeMs });
        event("bye", { disposeMs });
        setTimeout(() => process.exit(0), 120);
        return;
      }
      default:
        reply(false, undefined, `未知方法 ${method}`);
    }
  } catch (e) {
    reply(false, undefined, e);
  }
}

pp.on("message", (e) => {
  const m = e?.data;
  if (!m || typeof m !== "object") return;
  if (m.kind === "respond") {
    const cb = pending.get(m.id);
    if (cb) {
      pending.delete(m.id);
      cb(m);
    }
    return;
  }
  if (m.kind === "invoke") {
    void handle(m);
    return;
  }
  if (m.kind === "cancel") {
    void (async () => {
      try {
        await S.session?.abort?.();
        event("milestone", { what: "aborted", at: t() });
      } catch (err) {
        event("log", { level: "warn", text: `abort 抛错：${err?.message}` });
      }
    })();
    return;
  }
  if (m.kind === "control" && m.name === "crash") {
    event("log", { level: "info", text: "按控制指令硬崩（P1-b 崩溃隔离对照组）" });
    setTimeout(() => process.crash(), 50);
  }
});

process.on("unhandledRejection", (r) => event("log", { level: "error", text: `unhandledRejection: ${r?.message ?? r}` }));
process.on("exit", () => {
  try {
    event("bye", { reason: "exit" });
  } catch {
    /* 管道已关 */
  }
});

event("ready", { pid: process.pid, node: process.versions.node, electron: process.versions.electron, cwd: process.cwd(), mem: mem(), at: t() });
