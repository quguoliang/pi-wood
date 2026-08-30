/**
 * Pi SDK 的最小结构类型（v0.84.4 实测口径，见执行计划 §8）。
 * 只声明 SdkAdapter 用到的面，避免引入完整类型依赖到渲染层类型检查。
 */
export interface AgentSessionLike {
  sessionFile: string;
  sessionId: string;
  model?: { provider: string; id: string } | undefined;
  thinkingLevel?: string | undefined;
  isStreaming?: boolean | undefined;
  subscribe(fn: (event: unknown) => void): void;
  prompt(text: string, options?: Record<string, unknown>): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  abort(): Promise<void>;
  setModel(model: { provider: string; id: string }): Promise<void>;
  setThinkingLevel(level: string): Promise<void>;
  compact(customInstructions?: string): Promise<void>;
  bindExtensions(bindings: Record<string, unknown>): Promise<void>;
  dispose?(): void;
}

export interface AgentSessionServicesLike {
  modelRuntime: {
    getAvailable(): Promise<readonly { provider: string; id: string }[]>;
    /** 完整 Model 对象（含 api/baseUrl 等），setModel 必须用它而非裸 {provider,id} */
    getModel(providerId: string, modelId: string): unknown;
  };
}

export interface RuntimeFactoryOptions {
  cwd: string;
  agentDir: string;
  sessionManager: unknown;
}

export interface PiModule {
  createAgentSessionServices(options: {
    cwd: string;
    agentDir?: string;
    resourceLoaderOptions?: { extensionFactories?: unknown[] };
  }): Promise<AgentSessionServicesLike>;
  createAgentSessionFromServices(options: {
    services: AgentSessionServicesLike;
    sessionManager: unknown;
    customTools?: unknown;
  }): Promise<{ session: AgentSessionLike }>;
  createAgentSessionRuntime(
    factory: (opts: RuntimeFactoryOptions) => Promise<{
      session: AgentSessionLike;
      services: AgentSessionServicesLike;
    }>,
    options: { cwd: string; agentDir: string; sessionManager: unknown },
  ): Promise<{ session: AgentSessionLike; services: AgentSessionServicesLike }>;
  SessionManager: { create(cwd: string): unknown };
  getAgentDir(): string;
}
