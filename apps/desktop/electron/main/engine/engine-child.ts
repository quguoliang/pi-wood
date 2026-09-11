/**
 * 引擎子进程入口（T8.1，方案 §7.9 D 方案）
 *
 * 一条对话 = 一个本文件起的 utilityProcess。Pi SDK 在这里装配并运行，主进程只经 RPC 帧驱动它。
 *
 * 为什么必须是独立入口文件、不能打进主进程 bundle 的 `index.js`：
 * - 它是被 `utilityProcess.fork` 直接加载的模块，必须自成一体的 ESM；
 * - 它**只允许 import electron-free 的模块**（host-tool-specs / @pi-wood/engine/sdk / ipc-schema）：
 *   child 里 `import { BrowserWindow } from "electron"` 拿到的是残缺模块，会在运行期炸。
 *   桌面能力（浏览器面板、记忆库、审批卡、子代理守卫）一律经 `host:*` 反向 RPC 回主进程执行。
 * - 打包态随 asar 走（见 electron-builder.yml 的 asarUnpack 说明与 T8.0 P1-d 结论）。
 *
 * 关停口径：只走 `SdkAdapter.stop()`（内部 `runtime.dispose()` → 先广播 session_shutdown
 * 再 dispose session），否则 MCP / 子代理这类靠 session_shutdown 回收外部资源的扩展会留孤儿。
 */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { SdkAdapter } from "@pi-wood/engine/sdk";
import type { DesktopUiBridge } from "@pi-wood/engine";
import type { EngineRpcMethod, EngineReverseRpcMethod } from "@pi-wood/ipc-schema";
import {
  ENGINE_RPC_VERSION,
  decodeFrameLoose,
  frameErrorText,
  makeRespond,
  nowEpochMs,
  makeMetric,
  validateRpcParams,
} from "@pi-wood/ipc-schema";
import { ALL_HOST_TOOL_SPECS } from "../agent-tools/host-tool-specs";
import type { PiWoodSubagentBridge, PiWoodSubagentRuntimeRef } from "../subagent/bridge";
import { readGenUiAppendPrompt } from "./gen-ui-prompt";

/* ---------------- parentPort 帧管道 ---------------- */

interface ParentPortLike {
  postMessage(message: unknown): void;
  on(event: "message" | "close" | "disconnect", listener: (e?: { data?: unknown }) => void): void;
}

const pp = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (!pp) {
  console.error("engine-child: 必须经 utilityProcess.fork 启动（无 process.parentPort）");
  process.exit(2);
}
const port = pp as ParentPortLike;

const BOOT = performance.now();
const elapsed = () => Math.round(performance.now() - BOOT);

function post(frame: Record<string, unknown>): void {
  try {
    port.postMessage({ v: ENGINE_RPC_VERSION, ...frame });
  } catch (err) {
    // 不可克隆的载荷（函数/Error/符号）会在这里现形——宁可记一条 log 帧，也不要让 child 静默僵死
    console.error(`engine-child: 帧发送失败（${String(frame.kind)}）：${frameErrorText(err)}`);
  }
}

const T0 = 0; // 无超时（由对端保证收敛）
let upSeq = 0; // 上行 event 帧的单调 seq（主进程据此对账丢帧）
let reqSeq = 0; // 上行 invoke 的请求 id（与下行 id 空间互不干涉）
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer?: NodeJS.Timeout }>();

/**
 * 反向 RPC（child → main）：宿主工具、ctx.ui、审批裁决、子代理守卫。
 * `metric` 一旦给出，成功回执后用 **child 单时钟**自计往返并 fire 一条 metric 帧；
 * `when` 用来挑样本——审批只在「未走用户卡的自动裁决」时记（人的思考时间不是通道延迟），
 * 超时/失败路径一律不记（否则把 120s 等待当成 RPC 成本）。
 */
interface RpcMetric {
  name: string;
  when?(value: unknown): boolean;
}
function rpc(method: EngineReverseRpcMethod, params?: unknown, timeoutMs = 30_000, metric?: RpcMetric): Promise<unknown> {
  const id = ++reqSeq;
  const t0 = performance.now();
  return new Promise<unknown>((resolve, reject) => {
    const timer =
      timeoutMs === T0
        ? undefined
        : setTimeout(() => {
            pending.delete(id);
            reject(new Error(`宿主未应答：${method}（${timeoutMs}ms）`));
          }, timeoutMs);
    pending.set(id, {
      resolve: (v) => {
        if (metric && (!metric.when || metric.when(v))) post(makeMetric(metric.name, performance.now() - t0));
        resolve(v);
      },
      reject,
      timer,
    });
    post({ kind: "invoke", id, method, params });
  });
}

/** 不等回执的上行（快照类，丢了也不影响正确性） */
function fire(method: EngineReverseRpcMethod, params?: unknown): void {
  post({ kind: "invoke", id: ++reqSeq, method, params });
}

/* ---------------- 桌面能力的 child 侧替身 ---------------- */

/**
 * 宿主工具 → 代理工具：声明（name/label/description/TypeBox parameters）在 child 侧
 * 由 electron-free 的 spec 表本地取（**TypeBox 的 Symbol 键不可 structuredClone，
 * 故只传工具名、不传 schema**），execute 转发 `host:tool-execute` 回主进程执行。
 */
function makeProxyToolNames(names: string[]): unknown[] {
  const wanted = new Set(names);
  return ALL_HOST_TOOL_SPECS.filter((s) => wanted.has(s.name)).map((s) => ({
    name: s.name,
    label: s.label,
    description: s.description,
    parameters: s.parameters,
    async execute(toolCallId: string, params: Record<string, unknown>) {
      // 宿主侧工具可能很慢（浏览器导航/截图），给足余量；超时按工具失败回报而非让整轮卡死
      // hostToolRtt **含宿主执行时间**，只作展示，不参与通道红线判定（那条用 ping 与 approvalRtt）
      const r = (await rpc("host:tool-execute", { name: s.name, toolCallId, params }, 120_000, {
        name: "hostToolRtt",
      })) as { content: unknown[]; details?: object };
      return { content: r?.content ?? [], details: r?.details ?? {} };
    },
  }));
}

/** ctx.ui 桌面桥：阻塞对话框在主进程→渲染层往返；notify 不阻塞 */
const childUiBridge: DesktopUiBridge = {
  notify: (message, type) => {
    void rpc("host:ui", { op: "notify", message, type }, 5_000).catch(() => undefined);
  },
  select: async (title, options) => (await rpc("host:ui", { op: "select", title, options }, 150_000).catch(() => undefined)) as string | undefined,
  confirm: async (title, message) => Boolean(await rpc("host:ui", { op: "confirm", title, message }, 150_000).catch(() => false)),
  input: async (title, placeholder) => (await rpc("host:ui", { op: "input", title, placeholder }, 150_000).catch(() => undefined)) as string | undefined,
};

/**
 * 审批门（child 侧替身）。与主进程版的差别是刻意的：
 * **策略判定也留在主进程**（`host:approval` 一次往返直接给 allow/deny），child 不做任何本地裁决，
 * 因此不存在「child 自己放行」这条旁路；宿主不应答（超时）= 拒绝（deny-by-default）。
 */
function remoteApprovalGate() {
  return {
    name: "piwood-permission-gate",
    factory: (pi: { on: (ev: string, h: (event: { toolName: string; input?: unknown }) => Promise<unknown>) => void }) => {
      pi.on("tool_call", async (event) => {
        const verdict = (await rpc(
          "host:approval",
          { ticket: randomUUID(), toolName: event.toolName, input: event.input },
          150_000,
          // 只记自动裁决的往返（规则直拒/直放/票据失效）；弹了用户卡的那次含人的思考时间
          { name: "approvalRtt", when: (v) => (v as { auto?: boolean } | undefined)?.auto === true },
        ).catch((err: unknown) => ({ allow: false, reason: `宿主审批通道异常：${frameErrorText(err)}` }))) as {
          allow?: boolean;
          reason?: string;
        };
        if (verdict?.allow) return undefined;
        return { block: true, reason: verdict?.reason ?? "已由安全策略拦截" };
      });
    },
  };
}

/**
 * 子代理桥：被 SDK/jiti 以 ESM 加载的 vendored pi-subagent 扩展从 globalThis 读取。
 * 引擎进子进程后「每 child 一份」，进程内单例桥的串扰问题天然消失；
 * 主进程只保留 runs 的跨进程快照镜像（latest-wins，不等回执）。
 */
function installSubagentBridge(): () => Promise<void> {
  let runtime: PiWoodSubagentRuntimeRef | undefined;
  let unsubscribeRuns: (() => void) | undefined;
  let runsInFlight = false;

  const pushRuns = (): void => {
    if (!runtime || runsInFlight) return; // 快照类：在飞时丢弃旧的，最新状态总会被下一次订阅回调带到
    runsInFlight = true;
    fire("host:subagent", { op: "runs", runs: runtime.runs.list() });
    setTimeout(() => {
      runsInFlight = false;
    }, 50);
  };

  const bridge: PiWoodSubagentBridge = {
    buildChildGate: () => remoteApprovalGate() as never,
    guardChildTool: async (toolName, input, agentName) => {
      // ticket：与 remoteApprovalGate 同款一次性票据，主进程消费防重放（T8.4）
      const r = (await rpc("host:subagent", { op: "guard-tool", ticket: randomUUID(), toolName, input, agentName }, 150_000).catch(
        (err: unknown) => ({ reason: `宿主守卫通道异常：${frameErrorText(err)}` }),
      )) as { reason?: string };
      return r?.reason;
    },
    onRuntime: (rt) => {
      runtime = rt;
      unsubscribeRuns?.();
      try {
        unsubscribeRuns = rt.runs.subscribe(pushRuns);
        pushRuns();
      } catch {
        unsubscribeRuns = undefined;
      }
    },
    pushChildEvent: (runId, event) => fire("host:subagent", { op: "child-event", runId, event }),
  };
  (globalThis as unknown as { __piwoodSubagentBridge?: PiWoodSubagentBridge }).__piwoodSubagentBridge = bridge;

  return async () => {
    unsubscribeRuns?.();
    unsubscribeRuns = undefined;
    const rt = runtime;
    runtime = undefined;
    if (!rt) return;
    await rt.subagents.shutdown().catch(() => undefined);
    try {
      rt.delivery.shutdown();
    } catch {
      /* 已关停 */
    }
  };
}

/* ---------------- 引擎实例 ---------------- */

const E = {
  adapter: undefined as SdkAdapter | undefined,
  unsub: undefined as (() => void) | undefined,
  disposeSubagent: undefined as (() => Promise<void>) | undefined,
  sessionId: undefined as string | undefined,
};

async function requireAdapter(): Promise<SdkAdapter> {
  if (!E.adapter) throw new Error("引擎未启动：先调 start");
  return E.adapter;
}

async function doStart(params: {
  projectDir: string;
  agentDir?: string;
  hostToolNames?: string[];
  additionalExtensionPaths?: string[];
}): Promise<unknown> {
  if (E.adapter) await stopEngine("replace");
  E.disposeSubagent = installSubagentBridge();
  const adapter = new SdkAdapter();
  const info = await adapter.start({
    projectDir: params.projectDir,
    ...(params.agentDir ? { agentDir: params.agentDir } : {}),
    uiBridge: childUiBridge,
    customTools: makeProxyToolNames(params.hostToolNames ?? []),
    inlineExtensions: [remoteApprovalGate()],
    ...(params.additionalExtensionPaths && params.additionalExtensionPaths.length > 0
      ? { additionalExtensionPaths: params.additionalExtensionPaths }
      : {}),
    // T11.1 生成式 UI：provider 刻意在 child 侧就近注入（函数不过进程边界）；
    // 它每次资源加载/reload 读一次 ~/.pi-wood/settings.json，故主进程切换开关后触发
    // engine:reload 即热生效。
    appendSystemPromptProvider: readGenUiAppendPrompt,
  });
  E.adapter = adapter;
  E.sessionId = info.sessionId;
  E.unsub = adapter.subscribe((event) => {
    upSeq += 1;
    // sentAt：与主进程同一表达式（timeOrigin + performance.now()），主进程据此算 child→main 单跳
    post({ kind: "event", seq: upSeq, event, sentAt: nowEpochMs() });
  });
  return info;
}

async function stopEngine(reason: string): Promise<{ reason: string; ms: number }> {
  const adapter = E.adapter;
  const disposeSubagent = E.disposeSubagent;
  E.adapter = undefined;
  E.disposeSubagent = undefined;
  E.unsub?.();
  E.unsub = undefined;
  const t0 = performance.now();
  await adapter?.stop(); // 内部 runtime.dispose() → 先广播 session_shutdown 再 dispose
  await disposeSubagent?.();
  return { reason, ms: Math.round(performance.now() - t0) };
}

/** 优雅退出：回执 → bye → 留 120ms 让最后一帧出管道（主进程另有 kill 兜底） */
function gracefulExit(id: number | undefined, reason: string): void {
  void (async () => {
    const result = await stopEngine(reason).catch((err: unknown) => ({ reason, ms: -1, error: frameErrorText(err) }));
    if (id !== undefined) post(makeRespond(id, true, result));
    post({ kind: "bye", reason });
    setTimeout(() => process.exit(0), 120);
  })();
}

/* ---------------- 下行帧分派 ---------------- */

type Handler = (params: any) => Promise<unknown>;

const HANDLERS: Record<EngineRpcMethod, Handler> = {
  start: (p) => doStart(p),
  prompt: async (p) => {
    const a = await requireAdapter();
    await a.prompt(p);
  },
  steer: async (p) => (await requireAdapter()).steer(String(p?.text ?? "")),
  followUp: async (p) => (await requireAdapter()).followUp(String(p?.text ?? "")),
  abort: async () => (await requireAdapter()).abort(),
  setModel: async (p) => (await requireAdapter()).setModel(String(p?.provider), String(p?.modelId)),
  setThinkingLevel: async (p) => (await requireAdapter()).setThinkingLevel(String(p?.level)),
  getAvailableThinkingLevels: async () => (await requireAdapter()).getAvailableThinkingLevels(),
  getAvailableModels: async () => (await requireAdapter()).getAvailableModels(),
  compact: async (p) => (await requireAdapter()).compact(p?.custom),
  newSession: async (p) => (await requireAdapter()).newSession(p ?? {}),
  switchSession: async (p) => (await requireAdapter()).switchSession(String(p?.file)),
  fork: async (p) => (await requireAdapter()).fork(String(p?.entryId), p?.position === "at" ? "at" : "before"),
  // T9.2 缩略树 v2：同文件内切 leaf（SDK navigateTree；流式中会抛错，由主进程回执透传给渲染层 toast）
  navigateTree: async (p) => (await requireAdapter()).navigateTree(String(p?.targetId), { summarize: p?.summarize === true }),
  reload: async () => (await requireAdapter()).reload(),
  syncEnv: async (p) => (await requireAdapter()).syncEnv((p as { env?: Record<string, string> })?.env ?? {}),
  refreshModels: async () => (await requireAdapter()).refreshModels(),
  getState: async () => (await requireAdapter()).getState(),
  getSessionId: async () => ({ sessionId: E.adapter ? E.adapter.getSessionId() : E.sessionId }),
  getRuntimeInfo: async () => (await requireAdapter()).getRuntimeInfo(),
  listCommands: async () => (await requireAdapter()).listCommands(),
  stats: async () => ({
    pid: process.pid,
    cwd: process.cwd(),
    uptimeMs: elapsed(),
    mem: process.memoryUsage(),
    hasEngine: Boolean(E.adapter),
  }),
  // T8.9 度量：空操作、不碰引擎，主进程据此量 main→child→main 的纯通道往返
  ping: async (p) => ({ pong: Number((p as { n?: unknown } | undefined)?.n ?? 0) }),
  /**
   * T8.9 度量：探针专用。走**真实 IPC 通道**合成事件帧与审批往返，让「事件到达单跳」「审批往返」
   * 两条红线在没有模型流量时也有样本可判。非探针模式一律拒绝（不给生产留后门）。
   */
  debugEcho: async (p) => {
    if (process.env.PIWOOD_ENGINE_PROBE !== "1") throw new Error("debugEcho 仅探针模式可用（PIWOOD_ENGINE_PROBE=1）");
    const params = p as { events: number; approvals: number; gapMs: number };
    const gap = async (): Promise<void> => {
      if (params.gapMs > 0) await new Promise((r) => setTimeout(r, params.gapMs));
    };
    for (let i = 0; i < params.events; i += 1) {
      upSeq += 1;
      post({
        kind: "event",
        seq: upSeq,
        sentAt: nowEpochMs(),
        event: { type: "message_update", messageId: "piwood-latency-probe", assistantMessageEvent: { type: "text_delta", delta: "." } },
      });
      await gap(); // 按接近模型的速率灌 = 测「到达延迟」；0 = 突发全速 = 测「管子塞多快」
    }
    const verdicts: Array<{ allow: boolean; auto?: boolean; reason?: string }> = [];
    for (let i = 0; i < params.approvals; i += 1) {
      const v = (await rpc("host:approval", { ticket: `piwood-latency-probe-${i}`, toolName: "piwood_latency_probe" }, 10_000, {
        name: "approvalRtt",
        when: (x) => (x as { auto?: boolean } | undefined)?.auto === true,
      }).catch((err: unknown) => ({ allow: false, reason: `通道异常：${frameErrorText(err)}` }))) as {
        allow?: boolean;
        auto?: boolean;
        reason?: string;
      };
      // 回执随结果带回主进程：探针要端到端断言「child 确实收到 allow:false」，而不是只看主进程日志
      if (verdicts.length < 20) verdicts.push({ allow: v.allow === true, auto: v.auto, reason: v.reason?.slice(0, 60) });
    }
    return { events: params.events, approvals: params.approvals, gapMs: params.gapMs, verdicts };
  },
  shutdown: (p) => stopEngine(String(p?.reason ?? "quit")),
};

async function handleInvoke(id: number, method: unknown, params: unknown): Promise<void> {
  const checked = validateRpcParams(method, params);
  const respond = (ok: boolean, value?: unknown, error?: string): void => {
    post(makeRespond(id, ok, value, error));
  };
  if (!checked.ok) {
    respond(false, undefined, checked.error);
    return;
  }
  const handler = HANDLERS[method as EngineRpcMethod];
  if (!handler) {
    respond(false, undefined, `child 未实现命令 ${String(method)}`);
    return;
  }
  try {
    const value = await handler(checked.value);
    respond(true, value);
    // shutdown 是唯一「回完执就要自尽」的命令：先 respond 再 bye，留 120ms 让两帧出管道
    if (method === "shutdown") {
      post({ kind: "bye", reason: String((checked.value as { reason?: string })?.reason ?? "quit") });
      setTimeout(() => process.exit(0), 120);
    }
  } catch (err) {
    respond(false, undefined, frameErrorText(err));
  }
}

port.on("message", (e) => {
  const frame = decodeFrameLoose(e?.data);
  if (!frame) return;
  switch (frame.kind) {
    case "invoke":
      void handleInvoke(frame.id, frame.method, frame.params);
      return;
    case "respond": {
      const cb = pending.get(frame.id);
      if (!cb) return;
      pending.delete(frame.id);
      if (cb.timer) clearTimeout(cb.timer);
      if (frame.ok) cb.resolve(frame.value);
      else cb.reject(new Error(frame.error ?? "宿主返回失败"));
      return;
    }
    case "cancel":
      // 主进程取消在飞的 prompt：走 session.abort()（一轮会以此收尾并落盘）
      void E.adapter?.abort().catch(() => undefined);
      return;
    case "shutdown":
      gracefulExit(frame.id, String(frame.reason ?? "quit"));
      return;
    default:
      return;
  }
});

// 主进程没了（崩溃/退出）：child 不自留孤儿
port.on("close", () => {
  void (async () => {
    await stopEngine("parent-gone").catch(() => undefined);
    process.exit(0);
  })();
});

process.on("unhandledRejection", (reason) => {
  post({ kind: "log", level: "error", text: `unhandledRejection: ${frameErrorText(reason)}` });
});
process.on("uncaughtException", (err) => {
  post({ kind: "log", level: "error", text: `uncaughtException: ${frameErrorText(err)}` });
  process.exit(1); // 状态已不可信，交给主进程按崩溃处理（退避重启 / 标记 dead）
});

post({
  kind: "hello",
  pid: process.pid,
  protocol: ENGINE_RPC_VERSION,
  node: process.versions.node,
  electron: process.versions.electron,
});
