import type {
  AgentSessionServicesLike,
  AgentSessionLike,
  PiModule,
  RuntimeFactoryOptions,
} from "./pi-types";

/**
 * SdkAdapter —— EngineAdapter 的 SDK 进程内嵌入实现（MVP 主路径，方案 §2.1 决策 A）。
 *
 * 结构要点（R-1/R-2 实测修订，见执行计划 §8）：
 * - 装配路径：createAgentSessionServices → createAgentSessionFromServices
 *   → createAgentSessionRuntime(工厂, {cwd, agentDir, sessionManager})
 * - 持有 runtime（工厂随 newSession/switchSession/fork 按 cwd 重建服务）
 * - 事件经 normalizeEngineEvent 归一化后分发
 *
 * T8.P：主进程产物已切 ESM（desktop "type":"module"），Pi SDK（ESM-only）改静态 import——
 * 这是从「CJS 时代靠动态 import 挡 ERR_PACKAGE_PATH_NOT_EXPORTED」到「ESM 类型级安全」的验收靶子。
 * 渲染层不受影响：本文件仅在 "@pi-wood/engine/sdk" 子路径（主进程专用）可达，根入口仍只导出类型。
 *
 * T8.1 角色变化：自本批起本类是**引擎子进程内**的 Local 实现（由 electron/main/engine/engine-child.ts
 * 承载），主进程侧改用同 `EngineAdapter` 接口的 `RemoteEngineAdapter` 经 RPC 帧驱动它；同时它也是
 * 并发探针的 in-process 回路（Loopback 传输 + 同一帧协议），故 EngineAdapter 语义不得随传输方式分叉。
 */
import * as PiSdk from "@earendil-works/pi-coding-agent";
import { normalizeEngineEvent } from "./event-bridge";
import { disposeRuntimeGracefully } from "./runtime-dispose";
import type {
  AvailableModel,
  DesktopUiBridge,
  EngineAdapter,
  EngineSessionRef,
  EngineStartInfo,
  EngineStartOptions,
} from "./adapter";
import type { EngineCommand, EngineEvent, PromptCommand, RuntimeInfo, SessionState } from "@pi-wood/ipc-schema";

const noopBridge: DesktopUiBridge = {
  notify: () => {},
  select: async () => undefined,
  confirm: async () => false,
  input: async () => undefined,
};

export class SdkAdapter implements EngineAdapter {
  private pi: PiModule | undefined;
  private runtime: { session: AgentSessionLike; services: AgentSessionServicesLike } | undefined;
  private listeners = new Set<(e: EngineEvent) => void>();
  private uiBridge: DesktopUiBridge = noopBridge;
  private customUiWarned = false;
  private projectDir = "";
  private agentDir: string | undefined;
  private opts: EngineStartOptions | undefined;
  /** 最近一次装配的扩展/会话诊断（引擎在子进程时随 start 回执上报给注册表） */
  private lastDiagnostics: Array<{ type?: string; message: string }> = [];

  async start(opts: EngineStartOptions): Promise<EngineStartInfo> {
    const t0 = performance.now();
    const timings: Record<string, number> = {};
    this.opts = opts;
    this.projectDir = opts.projectDir;
    this.agentDir = opts.agentDir;
    this.uiBridge = opts.uiBridge ?? noopBridge;

    this.pi = PiSdk as unknown as PiModule;
    const runtimeFactory = async (factoryOpts: RuntimeFactoryOptions) => {
      const ts = performance.now();
      const services: AgentSessionServicesLike = await this.pi!.createAgentSessionServices({
        cwd: factoryOpts.cwd,
        agentDir: factoryOpts.agentDir,
        resourceLoaderOptions: {
          extensionFactories: opts.inlineExtensions as never,
          ...(opts.additionalExtensionPaths && opts.additionalExtensionPaths.length > 0
            ? { additionalExtensionPaths: opts.additionalExtensionPaths }
            : {}),
        } as never,
      });
      timings.servicesMs = Math.round(performance.now() - ts);
      const result: { session: AgentSessionLike } = await this.pi!.createAgentSessionFromServices({
        services,
        sessionManager: factoryOpts.sessionManager,
        customTools: opts.customTools as never,
      });
      const diags = (services as { diagnostics?: unknown[] }).diagnostics;
      this.lastDiagnostics = (Array.isArray(diags) ? diags : []).map((d) => ({
        type: typeof (d as { type?: unknown })?.type === "string" ? (d as { type: string }).type : undefined,
        message: String((d as { message?: unknown })?.message ?? d ?? ""),
      }));
      if (this.lastDiagnostics.length > 0) {
        console.warn("[engine] session/extension diagnostics:", JSON.stringify(this.lastDiagnostics));
      }
      return { session: result.session, services };
    };

    const tr = performance.now();
    this.runtime = await this.pi.createAgentSessionRuntime(runtimeFactory, {
      cwd: this.projectDir,
      agentDir: this.agentDir ?? this.pi.getAgentDir(),
      sessionManager: this.pi.SessionManager.create(this.projectDir),
    });
    timings.runtimeMs = Math.round(performance.now() - tr);

    this.runtime.session.subscribe((raw: unknown) => {
      const event = normalizeEngineEvent(raw, (msg) => console.warn(msg));
      for (const fn of this.listeners) fn(event);
    });

    const tb = performance.now();
    await this.bindExtensions();
    timings.bindMs = Math.round(performance.now() - tb);
    timings.totalMs = Math.round(performance.now() - t0);

    const s = this.runtime.session;
    return {
      pid: process.pid,
      cwd: this.projectDir,
      sessionId: s.sessionId,
      sessionFile: s.sessionFile,
      tools: s.getActiveToolNames?.() ?? [],
      diagnostics: this.lastDiagnostics,
      timings,
      memRssMB: Math.round(process.memoryUsage().rss / 1e6),
    };
  }

  /**
   * 绑定扩展运行时（uiContext + rpc 模式）。每个会话（含 newSession/switchSession/fork
   * 经 runtimeFactory 重建的新会话）都必须 bind 一次，否则该会话的扩展不会收到
   * session_start，依赖 session_start 注册工具的扩展（如子代理）就不会挂上工具。
   */
  private async bindExtensions(): Promise<void> {
    if (!this.runtime) return;
    await this.runtime.session.bindExtensions({
      uiContext: this.createUiContext(),
      mode: "rpc",
    });
  }

  /**
   * 构建桌面 ctx.ui 面（方案 §5.2）。
   *
   * 升级容错要点：Pi SDK 的 runRpcMode 内部有一份完整的 createExtensionUIContext()
   * （select/confirm/input/notify/custom/editor/setTitle/setWidget/getAllThemes…），
   * 我们只需实现真正要落到桌面 UI 的子集；其余一律由 Proxy 兜底为 no-op。
   * 这样即便 pi-agent 升级新增了 ctx.ui.someMethod，扩展无条件调用也只会拿到
   * undefined 而非 "not a function" 崩溃——无需每次升级回来手工补 stub。
   */
  private createUiContext(): Record<string, unknown> {
    const bridge = this.uiBridge;
    // 纯文本主题垫片：pi-rpiv 等扩展的 TUI 渲染会读 ui.theme.fg(...)/bold(...) 链式取色。
    // 桌面 RPC 下没有真主题，这里降级为“原样返回字符串”，任何 chain 都不抛错（返回可继续调用+可取值的函数）。
    const lastStr = (args: unknown[]): string => {
      for (let i = args.length - 1; i >= 0; i--) if (typeof args[i] === "string") return args[i] as string;
      return "";
    };
    const plain: (this: unknown, ...args: unknown[]) => string = (...args: unknown[]) => lastStr(args);
    let themeShim: (this: unknown, ...args: unknown[]) => string;
    themeShim = new Proxy(plain, {
      apply: (_t, _s, args: unknown[]) => lastStr(args),
      // 返回代理自身（而非裸 target），保证 theme.a.b.c… 任意链式都不脱离垫片
      get: (_t, prop) => (typeof prop === "symbol" ? undefined : themeShim),
    });
    // ⚠ SDK 消费 uiContext 时做结构性拷贝（{...uiContext}），只保留 own enumerable key，
    //   所以下面外层 Proxy 对"被解构/引用调用"的方法（如 setStatus）不生效——
    //   已知 ctx.ui 成员必须逐个显式列出（对齐 SDK runRpcMode.createExtensionUIContext 全集）。
    //   Proxy 仅作"未来新增方法"的兜底安全网（动态访问时才生效）。
    const noop = () => {};
    const base: Record<string, unknown> = {
      // 阻塞式对话框经 IPC 往返渲染层（→ UiRequestDialogs）
      notify: (message: string, type?: "info" | "warning" | "error") =>
        bridge.notify(message, type),
      select: (title: string, options: string[]) => bridge.select(title, options),
      confirm: (title: string, message: string) => bridge.confirm(title, message),
      input: (title: string, placeholder?: string) => bridge.input(title, placeholder),
      // TUI-only / fire-and-forget：给安全返回值或 no-op，缺失即 "not a function" 崩
      custom: async () => {
        // 方案 §5.2：桌面宿主无自定义渲染面 → 降级为无操作，并向用户标注一次「桌面暂不支持」
        if (!this.customUiWarned) {
          this.customUiWarned = true;
          bridge.notify("扩展请求自定义 UI（ctx.ui.custom），桌面宿主暂不支持，已降级", "warning");
        }
        return undefined;
      },
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
      getTheme: () => themeShim,
      setTheme: () => ({ success: false, error: "桌面宿主不支持切换主题" }),
      theme: themeShim, // 属性值型成员（非方法），必须显式给，否则被 Proxy 兜底成函数
    };
    return new Proxy(base, {
      get(target, prop, recv) {
        if (prop in target) return Reflect.get(target, prop, recv);
        // 避免被误当作 thenable / 元属性；symbol 交回默认行为
        if (
          typeof prop === "symbol" ||
          prop === "then" ||
          prop === "catch" ||
          prop === "finally" ||
          prop === "toJSON" ||
          prop === "constructor" ||
          prop === "inspect" ||
          prop === "nodeType"
        ) {
          return undefined;
        }
        return () => undefined; // 未预置成员：可调用 no-op，覆盖未来 SDK 新增方法
      },
    });
  }

  async stop(): Promise<void> {
    // T8.1 前置：必须走 runtime.dispose()（先广播 session_shutdown 再 dispose session）。
    // 直接 session.dispose() 会让依赖 session_shutdown 回收外部资源的扩展
    // （MCP stdio 子进程 / 子代理 child 会话）泄漏成孤儿进程树。
    const rt = this.runtime;
    this.runtime = undefined;
    this.listeners.clear();
    const result = await disposeRuntimeGracefully(rt as never);
    if (!result.steps.includes("runtime.dispose")) {
      console.warn(`[engine] 关停未走 runtime.dispose（steps=${result.steps.join(">")}），扩展资源可能未回收`);
    }
  }

  subscribe(fn: (e: EngineEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async prompt(cmd: PromptCommand): Promise<void> {
    await this.session().prompt(cmd.text, {
      images: cmd.images,
      streamingBehavior: cmd.streamingBehavior,
    });
  }

  async steer(text: string): Promise<void> {
    await this.session().steer(text);
  }

  async followUp(text: string): Promise<void> {
    await this.session().followUp(text);
  }

  async abort(): Promise<void> {
    await this.session().abort();
  }

  async getAvailableModels(): Promise<AvailableModel[]> {
    const all = await this.services().modelRuntime.getAvailable();
    return all.map((m) => ({ provider: m.provider, id: m.id }));
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    // setModel 必须用完整 Model 对象（registry.getModel）；裸 {provider,id} 会导致
    // 请求退化（模型复读输入、不调工具）——T1.1 实测教训
    const model = this.services().modelRuntime.getModel(provider, modelId);
    if (!model) throw new Error(`unknown model: ${provider}/${modelId}`);
    await this.session().setModel(model as { provider: string; id: string });
  }

  async setThinkingLevel(level: string): Promise<void> {
    await this.session().setThinkingLevel(level);
  }

  async getAvailableThinkingLevels(): Promise<string[]> {
    return this.session().getAvailableThinkingLevels();
  }

  async compact(custom?: string): Promise<void> {
    await this.session().compact(custom);
  }

  async newSession(_opts?: { parentSession?: string }): Promise<EngineSessionRef> {
    await this.runtimeSession().newSession();
    this.rebindSession();
    await this.bindExtensions();
    return this.sessionRef();
  }

  /** 重载扩展资源（对应 Pi /reload） */
  async reload(): Promise<void> {
    await this.session().reload();
  }

  async switchSession(file: string): Promise<EngineSessionRef> {
    await this.runtimeSession().switchSession(file);
    this.rebindSession();
    await this.bindExtensions();
    return this.sessionRef();
  }

  async fork(entryId: string, pos: "before" | "at"): Promise<EngineSessionRef> {
    await this.runtimeSession().fork(entryId, pos);
    this.rebindSession();
    await this.bindExtensions();
    return this.sessionRef();
  }

  private sessionRef(): EngineSessionRef {
    const s = this.runtime?.session;
    return { sessionId: s?.sessionId, sessionFile: s?.sessionFile };
  }

  getSessionId(): string | undefined {
    return this.runtime?.session?.sessionId;
  }

  async getState(): Promise<SessionState> {
    const s = this.session();
    return {
      sessionId: s.sessionId,
      sessionFile: s.sessionFile,
      model: s.model ? `${s.model.provider}/${s.model.id}` : undefined,
      thinkingLevel: s.thinkingLevel,
      isStreaming: Boolean(s.isStreaming),
      contextUsage: s.getContextUsage(),
    };
  }

  async getRuntimeInfo(): Promise<Omit<RuntimeInfo, "git" | "cwd" | "platform" | "node">> {
    const s = this.session();
    const stats = s.getSessionStats?.();
    return {
      model: s.model ? `${s.model.provider}/${s.model.id}` : undefined,
      thinkingLevel: s.thinkingLevel,
      isStreaming: Boolean(s.isStreaming),
      contextUsage: s.getContextUsage?.(),
      tools: s.getActiveToolNames?.(),
      stats: stats
        ? {
            userMessages: stats.userMessages,
            assistantMessages: stats.assistantMessages,
            toolCalls: stats.toolCalls,
            tokens: stats.tokens,
            cost: stats.cost,
          }
        : undefined,
    };
  }

  // ---- 内部 ----

  /** T5.1：聚合扩展命令 + prompt 模板 + Skill，复用 session 公共成员；未启动降级为空 */
  async listCommands(): Promise<EngineCommand[]> {
    const s = this.runtime?.session;
    if (!s) return [];
    const out: EngineCommand[] = [];
    for (const c of s.extensionRunner?.getRegisteredCommands?.() ?? []) {
      out.push({ name: c.invocationName, description: c.description, source: "extension" });
    }
    for (const t of s.promptTemplates ?? []) {
      out.push({ name: t.name, description: t.description, source: "prompt" });
    }
    for (const sk of s.resourceLoader?.getSkills?.().skills ?? []) {
      out.push({ name: `skill:${sk.name}`, description: sk.description, source: "skill" });
    }
    return out;
  }

  private session(): AgentSessionLike {
    if (!this.runtime) throw new Error("SdkAdapter not started");
    return this.runtime.session;
  }

  private runtimeSession(): { newSession: () => Promise<void>; switchSession: (f: string) => Promise<void>; fork: (id: string, pos: string) => Promise<void> } {
    if (!this.runtime) throw new Error("SdkAdapter not started");
    return this.runtime as unknown as {
      newSession: () => Promise<void>;
      switchSession: (f: string) => Promise<void>;
      fork: (id: string, pos: string) => Promise<void>;
    };
  }

  private services(): AgentSessionServicesLike {
    if (!this.runtime) throw new Error("SdkAdapter not started");
    return this.runtime.services;
  }

  /** 会话替换（new/switch/fork）后重新订阅事件流 */
  private rebindSession(): void {
    if (!this.runtime) return;
    this.runtime.session.subscribe((raw: unknown) => {
      const event = normalizeEngineEvent(raw, (msg) => console.warn(msg));
      for (const fn of this.listeners) fn(event);
    });
  }
}
