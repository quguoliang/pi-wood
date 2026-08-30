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
 * Pi SDK 为运行时动态导入（保持本包类型可被渲染层安全引用）。
 */
import { normalizeEngineEvent } from "./event-bridge";
import type {
  AvailableModel,
  DesktopUiBridge,
  EngineAdapter,
  EngineStartOptions,
} from "./adapter";
import type { EngineEvent, PromptCommand, SessionState } from "@pidesk/ipc-schema";

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
  private projectDir = "";
  private agentDir: string | undefined;
  private opts: EngineStartOptions | undefined;

  async start(opts: EngineStartOptions): Promise<void> {
    this.opts = opts;
    this.projectDir = opts.projectDir;
    this.agentDir = opts.agentDir;
    this.uiBridge = opts.uiBridge ?? noopBridge;

    this.pi = (await import("@earendil-works/pi-coding-agent")) as unknown as PiModule;
    const runtimeFactory = async (factoryOpts: RuntimeFactoryOptions) => {
      const services: AgentSessionServicesLike = await this.pi!.createAgentSessionServices({
        cwd: factoryOpts.cwd,
        agentDir: factoryOpts.agentDir,
      });
      const result: { session: AgentSessionLike } = await this.pi!.createAgentSessionFromServices({
        services,
        sessionManager: factoryOpts.sessionManager,
      });
      return { session: result.session, services };
    };

    this.runtime = await this.pi.createAgentSessionRuntime(runtimeFactory, {
      cwd: this.projectDir,
      agentDir: this.agentDir ?? this.pi.getAgentDir(),
      sessionManager: this.pi.SessionManager.create(this.projectDir),
    });

    this.runtime.session.subscribe((raw: unknown) => {
      const event = normalizeEngineEvent(raw, (msg) => console.warn(msg));
      for (const fn of this.listeners) fn(event);
    });

    await this.runtime.session.bindExtensions({
      uiContext: {
        notify: (message: string, type?: "info" | "warning" | "error") =>
          this.uiBridge.notify(message, type),
        select: (title: string, options: string[]) => this.uiBridge.select(title, options),
        confirm: (title: string, message: string) => this.uiBridge.confirm(title, message),
        input: (title: string, placeholder?: string) => this.uiBridge.input(title, placeholder),
        onTerminalInput: () => () => {},
        setStatus: () => {},
        setWorkingMessage: () => {},
        setWorkingVisible: () => {},
        setWorkingIndicator: () => {},
        setHiddenThinkingLabel: () => {},
        setWidget: () => {},
        setFooter: () => {},
      },
      mode: "rpc",
    });
  }

  async stop(): Promise<void> {
    this.runtime?.session.dispose?.();
    this.runtime = undefined;
    this.listeners.clear();
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

  async compact(custom?: string): Promise<void> {
    await this.session().compact(custom);
  }

  async newSession(_opts?: { parentSession?: string }): Promise<void> {
    await this.runtimeSession().newSession();
    this.rebindSession();
  }

  async switchSession(file: string): Promise<void> {
    await this.runtimeSession().switchSession(file);
    this.rebindSession();
  }

  async fork(entryId: string, pos: "before" | "at"): Promise<void> {
    await this.runtimeSession().fork(entryId, pos);
    this.rebindSession();
  }

  async getState(): Promise<SessionState> {
    const s = this.session();
    return {
      sessionId: s.sessionId,
      sessionFile: s.sessionFile,
      model: s.model ? `${s.model.provider}/${s.model.id}` : undefined,
      thinkingLevel: s.thinkingLevel,
      isStreaming: Boolean(s.isStreaming),
    };
  }

  // ---- 内部 ----

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
