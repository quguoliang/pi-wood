/** preload 暴露的 window.pi 全局类型（唯一声明处） */
import type { RuntimeInfo, SubagentRunInfo, PluginStatus, PluginPanelEntry, PluginStatusItem } from "@pi-wood/ipc-schema";
export {};

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
      onUiRequest(cb: (data: { id: number; kind: "select" | "confirm" | "input"; title: string; options?: string[]; message?: string; placeholder?: string }) => void): () => void;
      uiRespond(id: number, value?: string | boolean): Promise<boolean>;
      onProbeLog(cb: (line: string) => void): () => void;
      onEngineEvent(cb: (event: Record<string, unknown>) => void): () => void;
      onBtwEvent(cb: (event: Record<string, unknown>) => void): () => void;
      onAssistResult(cb: (data: { recap: string; suggestions: string[] }) => void): () => void;
      onDiff(cb: (data: { id?: string; file: string; before?: string; after?: string; patch?: string }) => void): () => void;
      diffRevert(changeId: string): Promise<{ file: string; content: string }>;
      onE2EDone(cb: (data: { ok: boolean; error?: string }) => void): () => void;
      prompt(text: string, attachments?: string[]): Promise<void>;
      settingsGet(): Promise<Record<string, unknown>>;
      settingsSet(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
      engineStart(projectDir: string): Promise<boolean>;
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
      approvalDecide(id: number, allow: boolean): Promise<boolean>;
      approvalAcceptAll(): Promise<number>;
      onApprovalRequest(
        cb: (d: { id: number; title: string; message: string; toolName?: string }) => void,
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
      termCreate(opts: { cwd: string; shell?: string; cols?: number; rows?: number }): Promise<string>;
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
    };
  }
}
