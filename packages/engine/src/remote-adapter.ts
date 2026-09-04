import type {
  EngineCommand,
  EngineEvent,
  EngineRpcMethod,
  PromptCommand,
  RuntimeInfo,
  SessionState,
} from "@pi-wood/ipc-schema";
import type {
  AvailableModel,
  EngineAdapter,
  EngineSessionRef,
  EngineStartInfo,
  EngineStartOptions,
} from "./adapter";

/**
 * RemoteEngineAdapter —— EngineAdapter 的**跨进程**实现（T8.1，方案 §7.9 D 方案）。
 *
 * 它把接口方法逐条序列化成 `ENGINE_RPC_METHODS` 帧，交给引擎子进程里的 SdkAdapter 执行。
 * 设计要点（决定了 T8.1 的风险面）：
 * - `engine-manager` 的 30 个 handler 只改「取哪个 handle」，业务逻辑一律不动 →
 *   本类的返回值形状必须与进程内实现**逐字段一致**，故参数/返回一律走 `@pi-wood/ipc-schema` 的帧契约。
 * - 传输是可注入的（`EngineTransport`）：真机走 `utilityProcess` 帧管道，
 *   探针/单测走 in-process 回路（同一套帧、不 fork 进程），并发/串台才有确定性判据。
 * - `uiBridge` / `customTools` / `inlineExtensions` **不过进程边界**：它们的能力由 child
 *   侧生成的代理工具 + `host:*` 反向 RPC 还原（声明留在 electron-free 的 spec 表里）。
 * - 会话身份（sessionId）在主进程侧缓存：child 只在 start 与各会话替换方法的回执里带，
 *   审批门的 per-session 自动接受判定用缓存，不每帧问一次。
 */

/** 可注入的帧传输（EngineHost 的进程实现 / 探针的回路实现） */
export interface EngineTransport {
  /** 发一条下行命令并等上行 respond；timeoutMs=0 表示不限（长任务由 child 退出兜底） */
  invoke(method: EngineRpcMethod, params?: unknown, timeoutMs?: number): Promise<unknown>;
  /** 订阅上行事件帧（已按 seq 对账通过的事件） */
  onEvent(fn: (e: EngineEvent) => void): () => void;
  isAlive(): boolean;
  readonly transportKind: "child" | "loopback";
}

/** 命令级超时：装配/长任务宽松，只读查询收紧（child 卡死时渲染层不该一直转圈） */
const METHOD_TIMEOUTS: Partial<Record<EngineRpcMethod, number>> = {
  start: 120_000,
  shutdown: 15_000,
  compact: 180_000,
  reload: 90_000,
  prompt: 0, // 一轮对话可达数十分钟；child 死亡时由 transport 主动 reject
  steer: 0,
  followUp: 0,
  getState: 10_000,
  getSessionId: 10_000,
  getRuntimeInfo: 10_000,
  listCommands: 20_000,
  getAvailableModels: 30_000,
  getAvailableThinkingLevels: 10_000,
};

export class RemoteEngineAdapter implements EngineAdapter {
  private unsub: (() => void) | undefined;
  private sessionId: string | undefined;
  private startInfo: EngineStartInfo | undefined;
  private disposed = false;

  constructor(readonly transport: EngineTransport) {}

  private call<T>(method: EngineRpcMethod, params?: unknown, timeoutMs?: number): Promise<T> {
    if (this.disposed) return Promise.reject(new Error(`引擎已关停，忽略 ${method}`));
    return this.transport.invoke(method, params, timeoutMs ?? METHOD_TIMEOUTS[method] ?? 15_000) as Promise<T>;
  }

  /** start 的可序列化子集：只把 cwd/agentDir/宿主工具名/扩展路径传下去 */
  async start(opts: EngineStartOptions): Promise<EngineStartInfo> {
    const info = await this.call<EngineStartInfo>("start", {
      projectDir: opts.projectDir,
      ...(opts.agentDir ? { agentDir: opts.agentDir } : {}),
      hostToolNames: opts.hostToolNames ?? [],
      additionalExtensionPaths: opts.additionalExtensionPaths ?? [],
      ...(opts.approvalMode ? { approvalMode: opts.approvalMode } : {}),
    });
    this.startInfo = info;
    this.sessionId = info.sessionId;
    return info;
  }

  get bootInfo(): EngineStartInfo | undefined {
    return this.startInfo;
  }

  async stop(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsub?.();
    this.unsub = undefined;
    // shutdown 帧让 child 走 runtime.dispose()（广播 session_shutdown）后自行退出；
    // 超时/失败都不在这里抛——进程兜底由 EngineHost 的 kill + 看门狗负责。
    await this.call("shutdown").catch(() => undefined);
  }

  subscribe(fn: (e: EngineEvent) => void): () => void {
    this.unsub?.();
    const off = this.transport.onEvent(fn);
    this.unsub = off;
    return off;
  }

  async prompt(cmd: PromptCommand): Promise<void> {
    await this.call("prompt", cmd);
  }
  async steer(text: string): Promise<void> {
    await this.call("steer", { text });
  }
  async followUp(text: string): Promise<void> {
    await this.call("followUp", { text });
  }
  async abort(): Promise<void> {
    await this.call("abort", undefined, 10_000);
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    await this.call("setModel", { provider, modelId });
  }
  async setThinkingLevel(level: string): Promise<void> {
    await this.call("setThinkingLevel", { level });
  }
  async getAvailableThinkingLevels(): Promise<string[]> {
    return this.call("getAvailableThinkingLevels");
  }
  async getAvailableModels(): Promise<AvailableModel[]> {
    return this.call("getAvailableModels");
  }
  async compact(custom?: string): Promise<void> {
    await this.call("compact", { custom });
  }
  async reload(): Promise<void> {
    await this.call("reload");
  }

  async newSession(opts?: { parentSession?: string }): Promise<EngineSessionRef> {
    const ref = await this.call<EngineSessionRef>("newSession", opts ?? {});
    if (ref?.sessionId) this.sessionId = ref.sessionId;
    return ref;
  }
  async switchSession(file: string): Promise<EngineSessionRef> {
    const ref = await this.call<EngineSessionRef>("switchSession", { file });
    if (ref?.sessionId) this.sessionId = ref.sessionId;
    return ref;
  }
  async fork(entryId: string, pos: "before" | "at"): Promise<EngineSessionRef> {
    const ref = await this.call<EngineSessionRef>("fork", { entryId, position: pos });
    if (ref?.sessionId) this.sessionId = ref.sessionId;
    return ref;
  }

  async getState(): Promise<SessionState> {
    const s = await this.call<SessionState>("getState");
    if (s?.sessionId) this.sessionId = s.sessionId;
    return s;
  }

  /** 缓存值：审批门每次工具调用都要问，不能为此跨进程往返 */
  getSessionId(): string | undefined {
    return this.sessionId;
  }

  async getRuntimeInfo(): Promise<Omit<RuntimeInfo, "git" | "cwd" | "platform" | "node">> {
    return this.call("getRuntimeInfo");
  }

  async listCommands(): Promise<EngineCommand[]> {
    return this.call("listCommands");
  }

  /** 探针/注册表用：child 是否还在 */
  isAlive(): boolean {
    return this.transport.isAlive();
  }
}

/** 会话替换类回执的统一取用（child 侧 newSession/switchSession/fork 后回传） */
export function refSessionId(ref: EngineSessionRef | void): string | undefined {
  return (ref as EngineSessionRef | undefined)?.sessionId;
}
