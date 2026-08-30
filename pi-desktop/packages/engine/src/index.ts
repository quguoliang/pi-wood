/**
 * EngineAdapter 接口（方案 §2.1）。
 * T0.2 落地 sdk-adapter 时填充实现；RPC 实现按 R-4 决策推迟（接口保留）。
 *
 * 注意：newSession/switchSession/fork 由 createAgentSessionRuntime() 返回的
 * AgentSessionRuntime 提供（不在 AgentSession 上）；sdk-adapter 需持有 runtime 实例。
 */

export interface PromptOpts {
  images?: unknown[];
}

export interface EngineAdapter {
  start(opts: EngineStartOptions): Promise<void>;
  stop(): Promise<void>;
  subscribe(fn: (e: unknown) => void): () => void;
  prompt(text: string, opts?: PromptOpts): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  abort(): Promise<void>;
  setModel(provider: string, modelId: string): Promise<void>;
  setThinkingLevel(level: string): Promise<void>;
  compact(custom?: string): Promise<unknown>;
  newSession(opts?: { parentSession?: string }): Promise<void>;
  switchSession(file: string): Promise<void>;
  fork(entryId: string, pos: "before" | "at"): Promise<void>;
  getState(): Promise<unknown>;
  getSessionStats(): Promise<unknown>;
}

export interface EngineStartOptions {
  cwd: string;
}

export const ENGINE_ADAPTER_TODO = "T0.2: 实现 SdkAdapter（依赖 @earendil-works/pi-coding-agent，锁版本）";
