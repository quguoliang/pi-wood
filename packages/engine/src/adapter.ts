import type { EngineCommand, EngineEvent, PromptCommand, RuntimeInfo, SessionState } from "@pi-wood/ipc-schema";

/**
 * EngineAdapter 接口（方案 §2.1）——渲染层与主进程引擎之间唯一的抽象边界。
 *
 * - MVP 仅实现 SdkAdapter（`./sdk-adapter`，经 `@pi-wood/engine/sdk` 子路径导出）；
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
  /** 宿主注册的自定义工具（如 browser_*），经 createAgentSessionFromServices 注入 */
  customTools?: unknown[];
  /** 宿主 inline 扩展（如审批门），经 resourceLoaderOptions.extensionFactories 注入 */
  inlineExtensions?: unknown[];
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
  getAvailableThinkingLevels(): string[];
  getAvailableModels(): Promise<AvailableModel[]>;

  compact(custom?: string): Promise<void>;

  /** R-2：以下三个经 AgentSessionRuntime */
  newSession(opts?: { parentSession?: string }): Promise<void>;
  switchSession(file: string): Promise<void>;
  fork(entryId: string, pos: "before" | "at"): Promise<void>;

  getState(): Promise<SessionState>;

  /** T7.2：同步取当前会话 id（供审批门判定 per-session 自动接受）；引擎未启动返回 undefined。 */
  getSessionId(): string | undefined;

  /** Pi 会话真实运行时信息（模型/思考级别/激活工具/会话统计）；git 等宿主侧字段由主进程补充 */
  getRuntimeInfo(): Promise<Omit<RuntimeInfo, "git" | "cwd" | "platform" | "node">>;

  /** T5.1：聚合可执行命令（扩展命令 + prompt 模板 + Skill），复用 session 公共成员；未启动返回空 */
  listCommands(): EngineCommand[];
}
