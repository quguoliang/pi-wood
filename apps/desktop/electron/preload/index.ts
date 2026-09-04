import { contextBridge, ipcRenderer } from "electron";

// ---------- T8.2 对话事件 envelope（preload 侧归一化） ----------

/** onEngineEvent 回调第二参：从 envelope 解出的归属 meta（legacy 裸事件时两个 id 字段为 null） */
interface EngineEventMetaLite {
  conversationId: string | null;
  projectDir: string | null;
  seq?: number;
  active?: boolean;
  legacy: boolean;
}

/**
 * `unwrapEnginePayload`（@pi-wood/ipc-schema）的复制版——**有意为之，不是疏忽**：
 * preload 构建走 externalizeDepsPlugin()（无 exclude），workspace 包 import 会被外置成
 * 沙箱 preload 里的运行时 require，打包后直接加载失败。权威口径在
 * packages/ipc-schema/src/engine.ts，那边改 envelope 判定必须同步这里。
 * 判据：带 `event` 对象字段 + 字符串 `conversationId` → envelope；有字符串 `type` → 旧裸事件；其余 malformed。
 */
const unwrapEnginePayloadLite = (
  raw: unknown,
): { event: Record<string, unknown> | null; meta: EngineEventMetaLite | null; reason?: string } => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { event: null, meta: null, reason: "载荷不是对象" };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.conversationId === "string" && typeof r.event === "object" && r.event !== null && !Array.isArray(r.event)) {
    const meta: EngineEventMetaLite = {
      conversationId: r.conversationId,
      projectDir: typeof r.projectDir === "string" ? r.projectDir : null,
      ...(typeof r.seq === "number" ? { seq: r.seq } : {}),
      ...(typeof r.active === "boolean" ? { active: r.active } : {}),
      legacy: false,
    };
    return { event: r.event as Record<string, unknown>, meta };
  }
  if (typeof r.type === "string") {
    return { event: r, meta: { conversationId: null, projectDir: null, legacy: true } };
  }
  return { event: null, meta: null, reason: "既不是 envelope 也不是裸事件" };
};

let engineEventDropped = 0;

const api = {
  ping: (): Promise<{ pong: boolean; electron: string; node: string }> =>
    ipcRenderer.invoke("app:ping"),
  // UI v3：平台判定 + 无边框窗口控制（Windows 自绘 TitleBar；macOS 走系统红绿灯不使用）
  platform: process.platform,
  winMinimize: (): Promise<void> => ipcRenderer.invoke("win:minimize"),
  winMaximizeToggle: (): Promise<void> => ipcRenderer.invoke("win:maximizeToggle"),
  winClose: (): Promise<void> => ipcRenderer.invoke("win:close"),
  winIsMaximized: (): Promise<boolean> => ipcRenderer.invoke("win:isMaximized"),
  onWinMaximizeChanged: (cb: (maximized: boolean) => void): (() => void) => {
    const handler = (_e: unknown, maximized: boolean): void => cb(maximized);
    ipcRenderer.on("win:onMaximizeChanged", handler);
    return () => ipcRenderer.removeListener("win:onMaximizeChanged", handler);
  },
  // T0.3 探针/桥接事件（正式化在 T1.1 IPC 层）
  onUiNotify: (cb: (data: { message: string; type: string }) => void): (() => void) => {
    const handler = (_e: unknown, data: { message: string; type: string }): void => cb(data);
    ipcRenderer.on("ui:notify", handler);
    return () => ipcRenderer.removeListener("ui:notify", handler);
  },
  // T8.4：载荷带对话归属（conversationId/projectName），原样透传给渲染层 PromptTray
  onUiRequest: (cb: (data: { id: number; kind: "select" | "confirm" | "input"; conversationId: string | null; projectName?: string; title: string; options?: string[]; message?: string; placeholder?: string }) => void): (() => void) => {
    const handler = (_e: unknown, data: { id: number; kind: "select" | "confirm" | "input"; conversationId: string | null; projectName?: string; title: string; options?: string[]; message?: string; placeholder?: string }): void => cb(data);
    ipcRenderer.on("ui:request", handler);
    return () => ipcRenderer.removeListener("ui:request", handler);
  },
  uiRespond: (id: number, value?: string | boolean, conversationId?: string | null): Promise<boolean> =>
    ipcRenderer.invoke("ui:respond", { id, value, conversationId: conversationId ?? null }),
  onProbeLog: (cb: (line: string) => void): (() => void) => {
    const handler = (_e: unknown, line: string): void => cb(line);
    ipcRenderer.on("probe:log", handler);
    return () => ipcRenderer.removeListener("probe:log", handler);
  },
  // T0.6 E2E 通道 → T8.2：main 推的是 envelope（每条对话都推），这里归一成 cb(event, meta)
  onEngineEvent: (
    cb: (event: Record<string, unknown>, meta: EngineEventMetaLite) => void,
  ): (() => void) => {
    const handler = (_e: unknown, raw: unknown): void => {
      const { event, meta, reason } = unwrapEnginePayloadLite(raw);
      if (!event || !meta) {
        // 丢事件不许静默：首条与之后每 200 条 warn 一次，带原因与累计数
        engineEventDropped += 1;
        if (engineEventDropped === 1 || engineEventDropped % 200 === 0) {
          console.warn(
            `[preload] engine:event 载荷非法已丢弃（原因：${reason}，累计 ${engineEventDropped} 条）`,
            raw,
          );
        }
        return;
      }
      cb(event, meta);
    };
    ipcRenderer.on("engine:event", handler);
    return () => ipcRenderer.removeListener("engine:event", handler);
  },
  onBtwEvent: (cb: (event: Record<string, unknown>) => void): (() => void) => {
    const handler = (_e: unknown, event: Record<string, unknown>): void => cb(event);
    ipcRenderer.on("engine:btwEvent", handler);
    return () => ipcRenderer.removeListener("engine:btwEvent", handler);
  },
  onAssistResult: (cb: (data: { recap: string; suggestions: string[] }) => void): (() => void) => {
    const handler = (_e: unknown, data: { recap: string; suggestions: string[] }): void => cb(data);
    ipcRenderer.on("engine:assistResult", handler);
    return () => ipcRenderer.removeListener("engine:assistResult", handler);
  },
  onDiff: (cb: (data: { id?: string; file: string; before?: string; after?: string; patch?: string }) => void): (() => void) => {
    const handler = (_e: unknown, data: { id?: string; file: string; before?: string; after?: string; patch?: string }): void => cb(data);
    ipcRenderer.on("engine:diff", handler);
    return () => ipcRenderer.removeListener("engine:diff", handler);
  },
  diffRevert: (changeId: string): Promise<{ file: string; content: string }> =>
    ipcRenderer.invoke("engine:diffRevert", { changeId }),
  onE2EDone: (cb: (data: { ok: boolean; error?: string }) => void): (() => void) => {
    const handler = (_e: unknown, data: { ok: boolean; error?: string }): void => cb(data);
    ipcRenderer.on("e2e:done", handler);
    return () => ipcRenderer.removeListener("e2e:done", handler);
  },
  prompt: (text: string, attachments: string[] = []): Promise<void> =>
    ipcRenderer.invoke("engine:prompt", { text, attachments }),
  // 设置（T1.2 布局持久化；T1.1 正式化口径同 engine 域）
  settingsGet: (): Promise<Record<string, unknown>> => ipcRenderer.invoke("settings:get"),
  settingsSet: (patch: Record<string, unknown>): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke("settings:set", patch),
  // T1.3/T1.4 引擎与数据域
  engineStart: (projectDir: string): Promise<boolean> =>
    ipcRenderer.invoke("engine:start", { projectDir }),
  // T8.3 对话域：切可见对话（主进程据此做可见性节流）+ 注册表面板
  setActiveConversation: (conversationId: string): Promise<unknown> =>
    ipcRenderer.invoke("engine:setActiveConversation", { conversationId }),
  listConversations: (): Promise<unknown[]> => ipcRenderer.invoke("engine:listConversations"),
  createConversation: (projectDir: string): Promise<unknown> =>
    ipcRenderer.invoke("engine:createConversation", { projectDir }),
  suspendConversation: (conversationId: string): Promise<boolean> =>
    ipcRenderer.invoke("engine:suspendConversation", { conversationId }),
  closeConversation: (conversationId: string): Promise<boolean> =>
    ipcRenderer.invoke("engine:closeConversation", { conversationId }),
  engineSteer: (text: string): Promise<void> => ipcRenderer.invoke("engine:steer", { text }),
  engineFollowUp: (text: string): Promise<void> => ipcRenderer.invoke("engine:followUp", { text }),
  engineAbort: (): Promise<void> => ipcRenderer.invoke("engine:abort"),
  engineNewSession: (): Promise<void> => ipcRenderer.invoke("engine:newSession"),
  engineModels: (): Promise<Array<{ provider: string; id: string }>> =>
    ipcRenderer.invoke("engine:getAvailableModels"),
  engineCommands: (): Promise<Array<{ name: string; description?: string; source: "extension" | "prompt" | "skill" | "builtin" }>> =>
    ipcRenderer.invoke("engine:listCommands"),
  engineState: (): Promise<Record<string, unknown>> => ipcRenderer.invoke("engine:getState"),
  piTheme: (): Promise<{ name: string; vars: Record<string, string | number>; colors: Record<string, string | number> } | null> =>
    ipcRenderer.invoke("engine:getPiTheme"),
  runtimeInfo: (): Promise<Record<string, unknown>> => ipcRenderer.invoke("engine:getRuntimeInfo"),
  engineThinkingLevels: (): Promise<string[]> => ipcRenderer.invoke("engine:getThinkingLevels"),
  engineSetThinking: (level: string): Promise<void> => ipcRenderer.invoke("engine:setThinking", { level }),
  engineCompact: (): Promise<void> => ipcRenderer.invoke("engine:compact"),
  projectList: (): Promise<unknown> => ipcRenderer.invoke("project:list"),
  projectAdd: (path: string): Promise<unknown> => ipcRenderer.invoke("project:add", { path }),
  projectPick: (): Promise<string | undefined> => ipcRenderer.invoke("project:pickDialog"),
  projectPickAttachments: (): Promise<Array<{ path: string; name: string; size: number; kind: "file" | "image" }>> =>
    ipcRenderer.invoke("project:pickAttachments"),
  stagePastedText: (text: string): Promise<{ path: string; name: string; size: number; kind: "file" | "image" }> =>
    ipcRenderer.invoke("engine:stagePastedText", { text }),
  projectTrust: (path: string): Promise<string> => ipcRenderer.invoke("project:trustStatus", { path }),
  sessionsList: (path: string): Promise<unknown> => ipcRenderer.invoke("sessions:list", { path }),
  sessionsTree: (file: string): Promise<unknown> => ipcRenderer.invoke("sessions:tree", { file }),
  sessionsMessages: (file: string): Promise<unknown> =>
    ipcRenderer.invoke("sessions:messages", { file }),
  exportSessionMarkdown: (defaultFileName: string, markdown: string): Promise<string | undefined> =>
    ipcRenderer.invoke("session:export", { defaultFileName, markdown }),
  engineSwitchSession: (file: string): Promise<boolean> =>
    ipcRenderer.invoke("engine:switchSession", { file }),
  debugStress: (count: number): Promise<number> => ipcRenderer.invoke("debug:stress", { count }),
  debugCapture: (file: string): Promise<boolean> => ipcRenderer.invoke("debug:capture", { file }),
  // T2.1 文件域
  fsTree: (dir?: string): Promise<unknown> => ipcRenderer.invoke("fs:tree", { dir }),
  fsRead: (path: string): Promise<{ content: string; truncated: boolean }> =>
    ipcRenderer.invoke("fs:read", { path }),
  fsWrite: (path: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke("fs:write", { path, content }),
  fsSearch: (query: string): Promise<unknown> => ipcRenderer.invoke("fs:search", { query }),
  // T2.3 终端 / T2.4 浏览器
  termCreate: (opts: { cwd: string; shell?: string }): Promise<string> =>
    ipcRenderer.invoke("term:create", opts),
  termWrite: (id: string, data: string): Promise<boolean> =>
    ipcRenderer.invoke("term:write", { id, data }),
  termResize: (id: string, cols: number, rows: number): Promise<boolean> =>
    ipcRenderer.invoke("term:resize", { id, cols, rows }),
  termKill: (id: string): Promise<boolean> => ipcRenderer.invoke("term:kill", { id }),
  onTermData: (cb: (d: { id: string; data: string }) => void): (() => void) => {
    const h = (_e: unknown, d: { id: string; data: string }): void => cb(d);
    ipcRenderer.on("term:onData", h);
    return () => ipcRenderer.removeListener("term:onData", h);
  },
  onTermExit: (cb: (d: { id: string; exitCode: number }) => void): (() => void) => {
    const h = (_e: unknown, d: { id: string; exitCode: number }): void => cb(d);
    ipcRenderer.on("term:onExit", h);
    return () => ipcRenderer.removeListener("term:onExit", h);
  },
  browserNavigate: (url: string): Promise<{ title: string }> =>
    ipcRenderer.invoke("browser:navigate", { url }),
  browserScreenshot: (): Promise<{ screenshot: string; url: string }> =>
    ipcRenderer.invoke("browser:screenshot"),
  listDevServers: (): Promise<Array<{ port: number; pid: number | null; command: string | null; host: string; url: string }>> =>
    ipcRenderer.invoke("engine:listDevServers"),
  btwAsk: (question: string, context?: string): Promise<boolean> =>
    ipcRenderer.invoke("engine:btwAsk", { question, context }),
  btwAbort: (): Promise<boolean> => ipcRenderer.invoke("engine:btwAbort"),
  btwClose: (): Promise<boolean> => ipcRenderer.invoke("engine:btwClose"),
  // T6.3 子代理运行时状态
  onSubagentRuns: (
    cb: (runs: Array<{ id: string; agent: string; harness: string; description: string; status: string; elapsedMs: number; turns: number; activity?: string }>) => void,
  ): (() => void) => {
    const h = (_e: unknown, runs: Array<{ id: string; agent: string; harness: string; description: string; status: string; elapsedMs: number; turns: number; activity?: string }>): void => cb(runs);
    ipcRenderer.on("engine:subagentRuns", h);
    return () => ipcRenderer.removeListener("engine:subagentRuns", h);
  },
  subagentList: (): Promise<Array<{ id: string; agent: string; harness: string; description: string; status: string; elapsedMs: number; turns: number; activity?: string }>> =>
    ipcRenderer.invoke("engine:subagentList"),
  onSubagentEvent: (
    cb: (d: { runId: string; event: Record<string, unknown> }) => void,
  ): (() => void) => {
    const h = (_e: unknown, d: { runId: string; event: Record<string, unknown> }): void => cb(d);
    ipcRenderer.on("engine:subagentEvent", h);
    return () => ipcRenderer.removeListener("engine:subagentEvent", h);
  },
  // T3.2/T4.1
  providerList: (): Promise<unknown> => ipcRenderer.invoke("provider:list"),
  providerSetKey: (provider: string, key: string): Promise<boolean> =>
    ipcRenderer.invoke("provider:setKey", { provider, key }),
  providerRemoveKey: (provider: string): Promise<boolean> =>
    ipcRenderer.invoke("provider:removeKey", { provider }),
  providerAddCustom: (cfg: unknown): Promise<boolean> =>
    ipcRenderer.invoke("provider:addCustom", cfg),
  // T8.4：approval:decide 带「应答者所处对话」——主进程据此校验应答者必须是发起对话
  approvalDecide: (id: number, allow: boolean, conversationId?: string | null): Promise<boolean> =>
    ipcRenderer.invoke("approval:decide", { id, allow, conversationId: conversationId ?? null }),
  approvalAcceptAll: (): Promise<number> => ipcRenderer.invoke("approval:acceptAll"),
  // T8.4：点来源行/徽章「去应答」→ 主进程恢复该对话 pending 的 120s 计时并回执条数
  approvalFocusRequested: (conversationId: string): Promise<{ ok: boolean; pending: number }> =>
    ipcRenderer.invoke("approval:focus-requested", { conversationId }),
  onApprovalRequest: (
    cb: (d: { id: number; conversationId: string | null; projectName?: string; title: string; message: string; toolName?: string }) => void,
  ): (() => void) => {
    const h = (_e: unknown, d: { id: number; conversationId: string | null; projectName?: string; title: string; message: string; toolName?: string }): void => cb(d);
    ipcRenderer.on("approval:request", h);
    return () => ipcRenderer.removeListener("approval:request", h);
  },
  // T3.1/T3.4
  extensionsList: (): Promise<unknown> => ipcRenderer.invoke("extensions:list"),
  resourcesList: (): Promise<unknown> => ipcRenderer.invoke("resources:list"),
  engineReload: (): Promise<boolean> => ipcRenderer.invoke("engine:reload"),
  packagesList: (): Promise<unknown> => ipcRenderer.invoke("packages:list"),
  packagesInstall: (spec: string): Promise<{ ok: boolean; output: string }> =>
    ipcRenderer.invoke("packages:install", { spec }),
  packagesUninstall: (spec: string): Promise<{ ok: boolean; output: string }> =>
    ipcRenderer.invoke("packages:uninstall", { spec }),
  packagesUpdate: (spec?: string): Promise<{ ok: boolean; output: string }> =>
    ipcRenderer.invoke("packages:update", { spec }),
  packagesSearch: (query: string): Promise<{ ok: boolean; items: unknown[]; error?: string }> =>
    ipcRenderer.invoke("packages:search", { query }),
  engineSetModel: (provider: string, modelId: string): Promise<void> =>
    ipcRenderer.invoke("engine:setModel", { provider, modelId }),
  // T5.2 桌面插件系统（PluginHost）
  pluginsList: (): Promise<unknown[]> => ipcRenderer.invoke("plugins:list"),
  pluginsSetEnabled: (id: string, enabled: boolean): Promise<unknown[]> =>
    ipcRenderer.invoke("plugins:setEnabled", { id, enabled }),
  pluginsRestart: (id: string): Promise<unknown[]> => ipcRenderer.invoke("plugins:restart", { id }),
  pluginsReload: (): Promise<unknown[]> => ipcRenderer.invoke("plugins:reload"),
  pluginsDemo: (kind: "crash" | "overreach"): Promise<{ triggered: boolean; kind: string }> =>
    ipcRenderer.invoke("plugins:demo", { kind }),
  onPluginStatus: (cb: (runs: unknown[]) => void): (() => void) => {
    const h = (_e: unknown, runs: unknown[]): void => cb(runs);
    ipcRenderer.on("plugins:status", h);
    return () => ipcRenderer.removeListener("plugins:status", h);
  },
  onPluginOpenFile: (cb: (d: { path: string; focus?: boolean }) => void): (() => void) => {
    const h = (_e: unknown, d: { path: string; focus?: boolean }): void => cb(d);
    ipcRenderer.on("plugins:openFile", h);
    return () => ipcRenderer.removeListener("plugins:openFile", h);
  },
  onPluginPanels: (cb: (panels: unknown[]) => void): (() => void) => {
    const h = (_e: unknown, panels: unknown[]): void => cb(panels);
    ipcRenderer.on("plugins:panels", h);
    return () => ipcRenderer.removeListener("plugins:panels", h);
  },
  onPluginStatusbar: (cb: (items: unknown[]) => void): (() => void) => {
    const h = (_e: unknown, items: unknown[]): void => cb(items);
    ipcRenderer.on("plugins:statusbar", h);
    return () => ipcRenderer.removeListener("plugins:statusbar", h);
  },
  // T6.7 子代理 per-tool 权限
  subagentsListProfiles: (): Promise<unknown[]> => ipcRenderer.invoke("subagents:listProfiles"),
  subagentsSetPermission: (
    agent: string,
    tool: string,
    action: "allow" | "ask" | "deny" | "inherit",
  ): Promise<unknown[]> => ipcRenderer.invoke("subagents:setPermission", { agent, tool, action }),
  subagentsClearPermissions: (agent: string): Promise<unknown[]> =>
    ipcRenderer.invoke("subagents:clearPermissions", { agent }),
  // T7.5 目标模式
  goalGet: (sessionId: string): Promise<unknown> => ipcRenderer.invoke("goal:get", { sessionId }),
  goalSet: (
    sessionId: string,
    objective: string,
    opts?: { tokenBudget?: number; maxTurns?: number },
  ): Promise<unknown> => ipcRenderer.invoke("goal:set", { sessionId, objective, ...opts }),
  goalPause: (sessionId: string): Promise<unknown> => ipcRenderer.invoke("goal:pause", { sessionId }),
  goalResume: (sessionId: string): Promise<unknown> => ipcRenderer.invoke("goal:resume", { sessionId }),
  goalClear: (sessionId: string): Promise<unknown> => ipcRenderer.invoke("goal:clear", { sessionId }),
  goalUpdateObjective: (sessionId: string, objective: string): Promise<unknown> =>
    ipcRenderer.invoke("goal:updateObjective", { sessionId, objective }),
  onGoalStatus: (cb: (state: unknown) => void): (() => void) => {
    const h = (_e: unknown, state: unknown): void => cb(state);
    ipcRenderer.on("goal:status", h);
    return () => ipcRenderer.removeListener("goal:status", h);
  },
  // T7.7 代码审查
  reviewRun: (): Promise<unknown> => ipcRenderer.invoke("review:run"),
  // T7.10 Agent Memory
  memoryList: (): Promise<unknown> => ipcRenderer.invoke("memory:list"),
  memorySave: (input: unknown): Promise<unknown> => ipcRenderer.invoke("memory:save", input),
  memoryUpdate: (input: unknown): Promise<unknown> => ipcRenderer.invoke("memory:update", input),
  memorySetReviewed: (id: string, reviewed: boolean): Promise<boolean> =>
    ipcRenderer.invoke("memory:setReviewed", { id, reviewed }),
  memoryDelete: (id: string): Promise<boolean> => ipcRenderer.invoke("memory:delete", { id }),
  // T7.12 用量/配额
  getUsage: (month?: string): Promise<unknown> => ipcRenderer.invoke("engine:getUsage", { month }),
};

export type PiPreloadApi = typeof api;

contextBridge.exposeInMainWorld("pi", api);
