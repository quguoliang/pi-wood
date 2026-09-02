/**
 * 子代理桥（方案 1）：主进程（CJS）与被 SDK/jiti 以 ESM 加载的 vendored pi-subagent
 * 扩展之间的**同进程**契约。扩展在 ESM 世界，拿不到主进程里的 confirmViaRenderer，
 * 故由主进程在启动引擎前把能力挂到 globalThis，扩展读取并回传 runtime 以便回收。
 *
 * 声明为 ambient，会被 tsconfig.node（纳入 electron 目录下的 ts 源码）自动收集。
 */
export interface PiWoodSubagentBridge {
  /** 产出一个 child 内联审批门（结构等价 SDK InlineExtension 的 {name, factory} 形态）。 */
  buildChildGate: () => { name: string; factory: (pi: unknown) => void };
  /**
   * child 工具执行前的桌面审批守卫：返回拦截原因字符串=拒绝，返回 undefined=放行。
   * 因 child 会话的 tool_call 事件钩子不触发，故由被包装的 child 工具 execute 直接调用。
   */
  guardChildTool: (toolName: string, input: unknown) => Promise<string | undefined>;
  /** 扩展建好运行时后回传，供主进程在切项目/停用时回收。 */
  onRuntime: (runtime: PiWoodSubagentRuntimeRef) => void;
  /** T6.5：child 会话原始事件回调（runId, 事件）→ 主进程归一后推给渲染层只读子会话视图。 */
  pushChildEvent?: (runId: string, event: unknown) => void;
}

/** 主进程只需调 shutdown + 读 runs，故用最小结构类型，避免把 vendor 类型牵进 CJS 主进程。 */
export interface PiWoodSubagentRunView {
  id: string;
  agent: string;
  harness: string;
  description: string;
  status: "running" | "completed" | "failed" | "cancelled";
  elapsedMs: number;
  turns: number;
  activity?: string;
}

export interface PiWoodSubagentRuntimeRef {
  subagents: { shutdown: () => Promise<void> };
  delivery: { shutdown: () => void };
  /** T6.3：runs 注册表快照 + 变更订阅（供推送到渲染层子代理面板）。 */
  runs: {
    list(): readonly PiWoodSubagentRunView[];
    subscribe(listener: () => void): () => void;
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __piwoodSubagentBridge: PiWoodSubagentBridge | undefined;
}

export {};
