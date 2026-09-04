import { utilityProcess } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import type {
  EngineEvent,
  EngineRpcMethod,
  EngineUpFrame,
  HostApprovalParams,
  HostSubagentParams,
  HostToolExecuteParams,
  HostToolResult,
  HostUiParams,
} from "@pi-wood/ipc-schema";
import { ENGINE_RPC_VERSION, acceptSeq, decodeFrameLoose, frameErrorText, isEngineReverseRpcMethod, makeRespond } from "@pi-wood/ipc-schema";
import { RemoteEngineAdapter, type EngineTransport } from "@pi-wood/engine/sdk";
import type { EngineStartInfo, EngineStartOptions } from "@pi-wood/engine";

/**
 * EngineHost —— 「一条对话 = 一个引擎子进程」的进程与 RPC 属主（T8.1）。
 *
 * 它同时是：
 * - `EngineTransport` 的实现（把 RemoteEngineAdapter 的调用序列化进 parentPort 帧）；
 * - 反向 RPC 的服务端（child 借宿主能力：执行桌面工具、弹 ctx.ui、问审批、镜像子代理 runs）；
 * - 事件出口（按 seq 对账后交给注册表，丢帧计数不静默）；
 * - 生命周期属主（fork / 优雅关停 / 崩溃兜底 / 退出后的残留扫描）。
 *
 * 凭据口径：主进程 `reinjectProviderEnv()` 之后把**字符串化**的 process.env 随 fork 传下去，
 * 密钥只活在进程环境里，不落 child 磁盘（⚠ 值含 undefined 会让 fork 直接失败，见 T8.0 发现③）。
 */

export interface EngineHostDeps {
  conversationId: string;
  /** 子进程的工作目录（T8.6 起为该对话的 worktree） */
  cwd: string;
  executeHostTool(p: HostToolExecuteParams): Promise<HostToolResult>;
  requestUi(p: HostUiParams): Promise<unknown>;
  decideApproval(p: HostApprovalParams): Promise<{ allow: boolean; reason?: string }>;
  /** 可回传值：guard-tool 的拦截原因必须回到 child（fire-and-forget 的 runs/child-event 返回 undefined） */
  onSubagent(p: HostSubagentParams): unknown;
  onEvent(event: EngineEvent, seq: number): void;
  onDropped?(info: { seq: number; dropped: number; duplicate: boolean }): void;
  onLog?(level: string, text: string): void;
  onExit?(info: { code: number | null; crashed: boolean; unexpected: boolean }): void;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer?: NodeJS.Timeout;
  method: string;
}

/** child 入口解析：dev = out/main 里的独立产物；packaged = asar 内 + asar.unpacked 双候选 */
export function resolveEngineChildEntry(): { here: string; candidates: string[]; entry?: string } {
  const here = dirname(fileURLToPath(import.meta.url));
  const base = [
    join(here, "engine-child.js"),
    join(here, "../main/engine-child.js"),
    join(here, "../../electron/main/engine/engine-child.js"),
  ];
  // 打包态：asarUnpack 的文件落在 app.asar.unpacked 下；显式列出候选，不依赖 Electron 的隐式重定向
  const candidates = [...base];
  for (const p of base) {
    const unpacked = p.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
    if (unpacked !== p && !candidates.includes(unpacked)) candidates.push(unpacked);
  }
  return { here, candidates, entry: candidates.find((p) => existsSync(p)) };
}

export class EngineHost implements EngineTransport {
  readonly transportKind = "child" as const;
  readonly adapter: RemoteEngineAdapter;
  pid: number | undefined;
  lastSeq = 0;
  droppedEvents = 0;
  exitCode: number | null = null;
  private proc: ReturnType<typeof utilityProcess.fork> | undefined;
  private pending = new Map<number, Pending>();
  private reqSeq = 0;
  private eventSubs = new Set<(e: EngineEvent) => void>();
  private helloWaiters: Array<() => void> = [];
  private helloSeen = false;
  private dead = false;
  /** 由 dispose() 主动发起的退出（区别于崩溃） */
  private exiting = false;
  private startedAt = 0;
  private forkMs = -1;
  private bootInfo: EngineStartInfo | undefined;

  constructor(private readonly deps: EngineHostDeps) {
    this.adapter = new RemoteEngineAdapter(this);
  }

  get alive(): boolean {
    return !this.dead;
  }
  isAlive(): boolean {
    return !this.dead;
  }
  get boot(): EngineStartInfo | undefined {
    return this.bootInfo;
  }
  get forkToReadyMs(): number {
    return this.forkMs;
  }

  /** fork 子进程；ready 判据 = 收到 hello 帧（协议对齐 + pid 已知），引擎装配在 start() 里 */
  spawn(): Promise<{ pid?: number }> {
    const { here, candidates, entry } = resolveEngineChildEntry();
    if (!entry) {
      throw new Error(
        `引擎子进程入口未找到（form=${existsSync(join(here, "..")) ? "dev?" : "?"}）：${candidates.join(" | ")}。` +
          ` dev 需先 electron-vite build（out/main/engine-child.js），packaged 需 asarUnpack 该文件`,
      );
    }
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
    env.PIWOOD_ENGINE_CWD = this.deps.cwd;
    env.PIWOOD_ENGINE_CONVERSATION = this.deps.conversationId;
    delete env.ELECTRON_RUN_AS_NODE;

    this.startedAt = performance.now();
    const proc = utilityProcess.fork(entry, [], {
      stdio: ["ignore", "pipe", "pipe"],
      serviceName: `pi-wood-engine-${this.deps.conversationId}`,
      env,
    });
    this.proc = proc;
    proc.on("message", (msg: unknown) => this.onFrame(msg));
    proc.on("exit", (code: number | null) => this.onExit(code));
    proc.stdout?.on("data", (chunk: Buffer) => this.forward("out", chunk));
    proc.stderr?.on("data", (chunk: Buffer) => this.forward("err", chunk));
    return this.waitHello(60_000).then(() => ({ pid: this.pid }));
  }

  private forward(stream: "out" | "err", chunk: Buffer): void {
    const text = chunk?.toString?.() ?? "";
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.deps.onLog?.(stream === "err" ? "error" : "info", `[engine:${this.deps.conversationId.slice(0, 8)}] ${line.slice(0, 500)}`);
    }
  }

  private waitHello(timeoutMs: number): Promise<{ pid?: number }> {
    if (this.helloSeen) return Promise.resolve({ pid: this.pid });
    if (this.dead) return Promise.reject(new Error("引擎子进程已退出，未能握手"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`引擎子进程握手超时（${timeoutMs}ms）`)), timeoutMs);
      this.helloWaiters.push(() => {
        clearTimeout(timer);
        resolve({ pid: this.pid });
      });
    });
  }

  /* ---------------- EngineTransport ---------------- */

  invoke(method: EngineRpcMethod, params?: unknown, timeoutMs = 15_000): Promise<unknown> {
    if (this.dead) return Promise.reject(new Error(`引擎子进程已退出，${method} 未发出`));
    const proc = this.proc;
    if (!proc) return Promise.reject(new Error("引擎子进程未启动"));
    const id = ++this.reqSeq;
    return new Promise<unknown>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`引擎子进程无应答：${method}（${timeoutMs}ms）`));
            }, timeoutMs)
          : undefined;
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        proc.postMessage({ v: ENGINE_RPC_VERSION, kind: "invoke", id, method, params });
      } catch (err) {
        this.pending.delete(id);
        if (timer) clearTimeout(timer);
        reject(new Error(`帧发送失败（${method}）：${frameErrorText(err)}`));
      }
    });
  }

  onEvent(fn: (e: EngineEvent) => void): () => void {
    this.eventSubs.add(fn);
    return () => this.eventSubs.delete(fn);
  }

  /* ---------------- 帧处理 ---------------- */

  private onFrame(raw: unknown): void {
    const frame = decodeFrameLoose(raw) as EngineUpFrame | undefined;
    if (!frame) return;
    switch (frame.kind) {
      case "hello": {
        if (frame.protocol !== ENGINE_RPC_VERSION) {
          console.warn(`[engine] 子进程协议版本 ${frame.protocol} 与主进程 ${ENGINE_RPC_VERSION} 不一致`);
        }
        this.pid = frame.pid;
        this.forkMs = Math.round(performance.now() - this.startedAt);
        this.helloSeen = true;
        for (const w of this.helloWaiters.splice(0)) w();
        return;
      }
      case "event": {
        const verdict = acceptSeq(this.lastSeq, frame.seq);
        if (!verdict.ok && verdict.dropped > 0) {
          this.droppedEvents += verdict.dropped;
          this.deps.onDropped?.({ seq: frame.seq, dropped: verdict.dropped, duplicate: false });
        }
        if (!verdict.ok && verdict.dropped === 0) {
          this.deps.onDropped?.({ seq: frame.seq, dropped: 0, duplicate: true });
          return; // 重复/倒退帧不进事件流（否则渲染层会出现双份 delta）
        }
        this.lastSeq = frame.seq;
        const event = frame.event as EngineEvent;
        this.deps.onEvent(event, frame.seq);
        for (const fn of this.eventSubs) fn(event);
        return;
      }
      case "respond": {
        const cb = this.pending.get(frame.id);
        if (!cb) return;
        this.pending.delete(frame.id);
        if (cb.timer) clearTimeout(cb.timer);
        if (frame.ok) cb.resolve(frame.value);
        else cb.reject(new Error(frame.error ?? `引擎子进程 ${cb.method} 失败`));
        return;
      }
      case "invoke":
        void this.handleReverse(frame);
        return;
      case "log":
        this.deps.onLog?.(frame.level, frame.text);
        return;
      case "bye":
        this.deps.onLog?.("info", `引擎子进程退出中（${frame.reason}）`);
        return;
      default:
        return;
    }
  }

  private async handleReverse(frame: { id: number; method: string; params?: unknown }): Promise<void> {
    const reply = (ok: boolean, value?: unknown, error?: string): void => {
      try {
        this.proc?.postMessage(makeRespond(frame.id, ok, value, error));
      } catch (err) {
        console.warn(`[engine] 反向回执发送失败：${frameErrorText(err)}`);
      }
    };
    if (!isEngineReverseRpcMethod(frame.method)) {
      reply(false, undefined, `主进程未实现反向命令 ${String(frame.method)}`);
      return;
    }
    try {
      switch (frame.method) {
        case "host:tool-execute":
          reply(true, await this.deps.executeHostTool(frame.params as HostToolExecuteParams));
          return;
        case "host:ui":
          reply(true, await this.deps.requestUi(frame.params as HostUiParams));
          return;
        case "host:approval":
          reply(true, await this.deps.decideApproval(frame.params as HostApprovalParams));
          return;
        case "host:subagent": {
          const value = await this.deps.onSubagent(frame.params as HostSubagentParams);
          reply(true, value);
          return;
        }
        default:
          reply(false, undefined, `未 handled 的反向命令 ${frame.method}`);
      }
    } catch (err) {
      // 反向通道故障一律以失败回执上抛：child 侧的门/审批据此拒绝（deny-by-default）
      reply(false, undefined, frameErrorText(err));
    }
  }

  private onExit(code: number | null): void {
    this.dead = true;
    this.exitCode = code;
    for (const [id, cb] of this.pending) {
      this.pending.delete(id);
      if (cb.timer) clearTimeout(cb.timer);
      cb.reject(new Error(`引擎子进程已退出（code=${code}），${cb.method} 中途中断`));
    }
    for (const w of this.helloWaiters.splice(0)) w(); // 让 spawn() 的等待者以「无 pid」收敛，而不是干等 60s
    const crashed = !this.exiting;
    if (crashed) console.warn(`[engine] 子进程异常退出（code=${code}, conv=${this.deps.conversationId}）`);
    this.deps.onExit?.({ code, crashed, unexpected: crashed });
  }

  /* ---------------- 生命周期 ---------------- */

  async startEngine(opts: EngineStartOptions): Promise<EngineStartInfo> {
    const info = await this.adapter.start(opts);
    this.bootInfo = info;
    return info;
  }

  /**
   * 优雅关停：shutdown 帧（child 内走 runtime.dispose → 先广播 session_shutdown 再 dispose）
   * → 等它自己退出 → 不退再 kill 兜底。
   * `PIWOOD_ENGINE_KILL_ONLY=1` 留给崩溃隔离实验（跳过优雅路径，直接看看门狗能不能暴露残留）。
   */
  async dispose(reason: "suspend" | "close" | "quit" = "quit"): Promise<{ code: number | null; graceful: boolean }> {
    const proc = this.proc;
    this.exiting = true;
    if (!proc || this.dead) return { code: this.exitCode, graceful: true };
    if (process.env.PIWOOD_ENGINE_KILL_ONLY !== "1") {
      await this.invoke("shutdown", { reason }, 20_000).catch(() => undefined);
    }
    let code = await this.waitForExit(3_000);
    let graceful = code !== null || this.dead;
    if (!this.dead) {
      proc.kill(); // 硬杀：child 里没被 session_shutdown 回收的外部进程由「退出后延迟扫描」负责暴露
      code = await this.waitForExit(5_000);
      graceful = false;
    }
    return { code, graceful };
  }

  private waitForExit(timeoutMs: number): Promise<number | null> {
    if (this.dead) return Promise.resolve(this.exitCode);
    return new Promise((resolve) => {
      const deadline = performance.now() + timeoutMs;
      const tick = setInterval(() => {
        if (this.dead) {
          clearInterval(tick);
          clearTimeout(bail);
          resolve(this.exitCode);
        } else if (performance.now() >= deadline) {
          clearInterval(tick);
          resolve(null);
        }
      }, 50);
      const bail = setTimeout(() => {
        clearInterval(tick);
        resolve(null);
      }, timeoutMs);
    });
  }

  kill(): void {
    try {
      this.proc?.kill();
    } catch {
      /* 已退出 */
    }
  }
}
