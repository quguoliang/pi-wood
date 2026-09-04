/** preload 暴露的 window.pi 全局类型（唯一声明处） */
import type { RuntimeInfo, SubagentRunInfo, PluginStatus, PluginPanelEntry, PluginStatusItem, SubagentProfileInfo, GoalState, ReviewResult, MemoryItem, MemoryListResult, UsageView } from "@pi-wood/ipc-schema";
export {};

/**
 * T8.2 engine:event 归属 meta：preload 把 envelope 归一化后随事件一起回调。
 * legacy=true = 旧裸事件（无归属信息），两个 id 字段为 null，渲染层按当前对话处理。
 */
export interface EngineEventMeta {
  conversationId: string | null;
  projectDir: string | null;
  seq?: number;
  active?: boolean;
  legacy: boolean;
}

declare global {
  /** 插件市场条目（npm 上以包发布的 Pi 扩展）。 */
  interface PiMarketItem {
    name: string;
    version: string;
    description: string;
    author: string;
    updated: string;
    source: string;
  }

  interface Window {
    pi: {
      ping(): Promise<{ pong: boolean; electron: string; node: string }>;
      platform: NodeJS.Platform;
      winMinimize(): Promise<void>;
      winMaximizeToggle(): Promise<void>;
      winClose(): Promise<void>;
      winIsMaximized(): Promise<boolean>;
      onWinMaximizeChanged(cb: (maximized: boolean) => void): () => void;
      onUiNotify(cb: (data: { message: string; type: string }) => void): () => void;
      // T8.4：审批 / ctx.ui 带对话归属——conversationId=发起对话（null=插件等全局请求），projectName=来源项目名
      onUiRequest(cb: (data: { id: number; kind: "select" | "confirm" | "input"; conversationId: string | null; projectName?: string; title: string; options?: string[]; message?: string; placeholder?: string }) => void): () => void;
      uiRespond(id: number, value?: string | boolean, conversationId?: string | null): Promise<boolean>;
      onProbeLog(cb: (line: string) => void): () => void;
      // T8.2：main 推 envelope（所有对话都推），preload 归一化后按 (event, meta) 回调，渲染层按 meta 路由
      onEngineEvent(cb: (event: Record<string, unknown>, meta: EngineEventMeta) => void): () => void;
      onBtwEvent(cb: (event: Record<string, unknown>) => void): () => void;
      onAssistResult(cb: (data: { recap: string; suggestions: string[] }) => void): () => void;
      onDiff(cb: (data: { id?: string; file: string; before?: string; after?: string; patch?: string }) => void): () => void;
      diffRevert(changeId: string): Promise<{ file: string; content: string }>;
      onE2EDone(cb: (data: { ok: boolean; error?: string }) => void): () => void;
      prompt(text: string, attachments?: string[]): Promise<void>;
      settingsGet(): Promise<Record<string, unknown>>;
      settingsSet(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
      engineStart(projectDir: string): Promise<boolean>;
      // T8.3 对话域（preload 已实装；声明成可选以免桥与消费者必须同刻改完）
      setActiveConversation?(conversationId: string): Promise<unknown>;
      listConversations?(): Promise<unknown[]>;
      createConversation?(projectDir: string): Promise<unknown>;
      suspendConversation?(conversationId: string): Promise<boolean>;
      closeConversation?(conversationId: string): Promise<boolean>;
      engineSteer(text: string): Promise<void>;
      engineFollowUp(text: string): Promise<void>;
      engineAbort(): Promise<void>;
      engineNewSession(): Promise<void>;
      engineModels(): Promise<Array<{ provider: string; id: string }>>;
      engineCommands(): Promise<Array<{ name: string; description?: string; source: "extension" | "prompt" | "skill" | "builtin" }>>;
      engineState(): Promise<{ sessionId?: string; model?: string; thinkingLevel?: string; isStreaming?: boolean; contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null } }>;
      piTheme(): Promise<{ name: string; vars: Record<string, string | number>; colors: Record<string, string | number> } | null>;
      runtimeInfo(): Promise<RuntimeInfo>;
      engineThinkingLevels(): Promise<string[]>;
      engineSetThinking(level: string): Promise<void>;
      engineCompact(): Promise<void>;
      projectList(): Promise<unknown>;
      projectAdd(path: string): Promise<unknown>;
      projectPick(): Promise<string | undefined>;
      projectPickAttachments(): Promise<Array<{ path: string; name: string; size: number; kind: "file" | "image" }>>;
      stagePastedText(text: string): Promise<{ path: string; name: string; size: number; kind: "file" | "image" }>;
      projectTrust(path: string): Promise<string>;
      sessionsList(path: string): Promise<unknown>;
      sessionsTree(file: string): Promise<unknown>;
      sessionsMessages(file: string): Promise<unknown>;
      exportSessionMarkdown(defaultFileName: string, markdown: string): Promise<string | undefined>;
      engineSwitchSession(file: string): Promise<boolean>;
      debugStress(count: number): Promise<number>;
      debugCapture(file: string): Promise<boolean>;
      fsTree(dir?: string): Promise<unknown>;
      fsRead(path: string): Promise<{ content: string; truncated: boolean }>;
      fsWrite(path: string, content: string): Promise<boolean>;
      fsSearch(query: string): Promise<unknown>;
      providerList(): Promise<unknown>;
      providerSetKey(provider: string, key: string): Promise<boolean>;
      providerRemoveKey(provider: string): Promise<boolean>;
      providerAddCustom(cfg: unknown): Promise<boolean>;
      // T8.4：conversationId = 应答者所处的对话（主进程校验「应答者必须是发起对话」，跨对话一律拒绝）
      approvalDecide(id: number, allow: boolean, conversationId?: string | null): Promise<boolean>;
      approvalAcceptAll(): Promise<number>;
      /** T8.4：点来源行/徽章「去应答」→ 恢复该对话 pending 的 120s 计时，回执 {ok, pending 条数} */
      approvalFocusRequested?(conversationId: string): Promise<{ ok: boolean; pending: number }>;
      onApprovalRequest(
        cb: (d: { id: number; conversationId: string | null; projectName?: string; title: string; message: string; toolName?: string }) => void,
      ): () => void;
      extensionsList(): Promise<unknown>;
      resourcesList(): Promise<unknown>;
      engineReload(): Promise<boolean>;
      packagesList(): Promise<{ packages: string[] }>;
      packagesInstall(spec: string): Promise<{ ok: boolean; output: string }>;
      packagesUninstall(spec: string): Promise<{ ok: boolean; output: string }>;
      packagesUpdate(spec?: string): Promise<{ ok: boolean; output: string }>;
      packagesSearch(query: string): Promise<{ ok: boolean; items: PiMarketItem[]; error?: string }>;
      engineSetModel(provider: string, modelId: string): Promise<void>;
      termCreate(opts: { cwd: string; conversationId?: string; shell?: string; cols?: number; rows?: number }): Promise<string>;
      termWrite(id: string, data: string): Promise<boolean>;
      termResize(id: string, cols: number, rows: number): Promise<boolean>;
      termKill(id: string): Promise<boolean>;
      onTermData(cb: (d: { id: string; data: string }) => void): () => void;
      onTermExit(cb: (d: { id: string; exitCode: number }) => void): () => void;
      browserNavigate(url: string): Promise<{ title: string }>;
      browserScreenshot(): Promise<{ screenshot: string; url: string }>;
      onBrowserShot(cb: (d: { screenshot: string }) => void): () => void;
      listDevServers(): Promise<Array<{ port: number; pid: number | null; command: string | null; host: string; url: string }>>;
      btwAsk(question: string, context?: string): Promise<boolean>;
      btwAbort(): Promise<boolean>;
      btwClose(): Promise<boolean>;
      onSubagentRuns(cb: (runs: SubagentRunInfo[]) => void): () => void;
      subagentList(): Promise<SubagentRunInfo[]>;
      onSubagentEvent(cb: (d: { runId: string; event: Record<string, unknown> }) => void): () => void;
      // T5.2 桌面插件系统
      pluginsList(): Promise<PluginStatus[]>;
      pluginsSetEnabled(id: string, enabled: boolean): Promise<PluginStatus[]>;
      pluginsRestart(id: string): Promise<PluginStatus[]>;
      pluginsReload(): Promise<PluginStatus[]>;
      pluginsDemo(kind: "crash" | "overreach"): Promise<{ triggered: boolean; kind: string }>;
      onPluginStatus(cb: (list: PluginStatus[]) => void): () => void;
      onPluginOpenFile(cb: (d: { path: string; focus?: boolean }) => void): () => void;
      onPluginPanels(cb: (panels: PluginPanelEntry[]) => void): () => void;
      onPluginStatusbar(cb: (items: PluginStatusItem[]) => void): () => void;
      // T6.7 子代理 per-tool 权限
      subagentsListProfiles(): Promise<SubagentProfileInfo[]>;
      subagentsSetPermission(agent: string, tool: string, action: "allow" | "ask" | "deny" | "inherit"): Promise<SubagentProfileInfo[]>;
      subagentsClearPermissions(agent: string): Promise<SubagentProfileInfo[]>;
      // T7.5 目标模式
      goalGet(sessionId: string): Promise<GoalState | null>;
      goalSet(sessionId: string, objective: string, opts?: { tokenBudget?: number; maxTurns?: number }): Promise<GoalState | null>;
      goalPause(sessionId: string): Promise<GoalState | null>;
      goalResume(sessionId: string): Promise<GoalState | null>;
      goalClear(sessionId: string): Promise<null>;
      goalUpdateObjective(sessionId: string, objective: string): Promise<GoalState | null>;
      onGoalStatus(cb: (state: GoalState | null) => void): () => void;
      // T7.7 代码审查
      reviewRun(): Promise<ReviewResult>;
      // T7.10 Agent Memory
      memoryList(): Promise<MemoryListResult>;
      memorySave(input: { title: string; body: string; scope?: "global" | "project"; type?: "fact" | "preference" | "reference" }): Promise<MemoryItem | null>;
      memoryUpdate(input: { id: string; title?: string; body?: string; type?: string }): Promise<MemoryItem | null>;
      memorySetReviewed(id: string, reviewed: boolean): Promise<boolean>;
      memoryDelete(id: string): Promise<boolean>;
      // T7.12 用量/配额
      getUsage(month?: string): Promise<UsageView | null>;
    };
  }
}
