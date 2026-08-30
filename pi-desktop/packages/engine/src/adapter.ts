import type { EngineEvent, PromptCommand, SessionState } from "@pidesk/ipc-schema";

/**
 * EngineAdapter 接口（方案 §2.1）——渲染层与主进程引擎之间唯一的抽象边界。
 *
 * - MVP 仅实现 SdkAdapter（`./sdk-adapter`，经 `@pidesk/engine/sdk` 子路径导出）；
 *   RPC 实现按 R-4 决策推迟，接口保留。
 * - 事件已是归一化后的 EngineEvent（归一化见 ./event-bridge）。
 * - 注意（R-2）：newSession/switchSession/fork 由 AgentSessionRuntime 提供，
 *   SdkAdapter 内部持有 runtime 而非裸 session。
 */

export interface EngineStartOptions {
  /** 项目目录（cwd 绑定资源发现与会话目录） */
  projectDir: string;
  /** agentDir 缺省取 getAgentDir() */
  agentDir?: string;
  /** 桌面 UI 桥（ctx.ui.* 的落点）；缺省 no-op */
  uiBridge?: DesktopUiBridge;
}

/** 方案 §5.2：ctx.ui 桌面桥。阻塞式对话框（select/confirm/input）由宿主经 IPC 往返渲染层实现 */
export interface DesktopUiBridge {
  notify(message: string, type?: "info" | "warning" | "error"): void;
  select(title: string, options: string[]): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  input(title: string, placeholder?: string): Promise<string | undefined>;
}

export interface AvailableModel {
  provider: string;
  id: string;
}

export interface EngineAdapter {
  start(opts: EngineStartOptions): Promise<void>;
  stop(): Promise<void>;

  /** 订阅归一化事件流；返回取消订阅函数 */
  subscribe(fn: (e: EngineEvent) => void): () => void;

  prompt(cmd: PromptCommand): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  abort(): Promise<void>;

  setModel(provider: string, modelId: string): Promise<void>;
  setThinkingLevel(level: string): Promise<void>;
  getAvailableModels(): Promise<AvailableModel[]>;

  compact(custom?: string): Promise<void>;

  /** R-2：以下三个经 AgentSessionRuntime */
  newSession(opts?: { parentSession?: string }): Promise<void>;
  switchSession(file: string): Promise<void>;
  fork(entryId: string, pos: "before" | "at"): Promise<void>;

  getState(): Promise<SessionState>;
}
