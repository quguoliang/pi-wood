import { contextBridge, ipcRenderer } from "electron";

const api = {
  ping: (): Promise<{ pong: boolean; electron: string; node: string }> =>
    ipcRenderer.invoke("app:ping"),
  // T0.3 探针/桥接事件（正式化在 T1.1 IPC 层）
  onUiNotify: (cb: (data: { message: string; type: string }) => void): (() => void) => {
    const handler = (_e: unknown, data: { message: string; type: string }): void => cb(data);
    ipcRenderer.on("ui:notify", handler);
    return () => ipcRenderer.removeListener("ui:notify", handler);
  },
  onProbeLog: (cb: (line: string) => void): (() => void) => {
    const handler = (_e: unknown, line: string): void => cb(line);
    ipcRenderer.on("probe:log", handler);
    return () => ipcRenderer.removeListener("probe:log", handler);
  },
  // T0.6 E2E 通道（T1.1 正式化）
  onEngineEvent: (cb: (event: Record<string, unknown>) => void): (() => void) => {
    const handler = (_e: unknown, event: Record<string, unknown>): void => cb(event);
    ipcRenderer.on("engine:event", handler);
    return () => ipcRenderer.removeListener("engine:event", handler);
  },
  onDiff: (cb: (data: { file: string; patch: string }) => void): (() => void) => {
    const handler = (_e: unknown, data: { file: string; patch: string }): void => cb(data);
    ipcRenderer.on("engine:diff", handler);
    return () => ipcRenderer.removeListener("engine:diff", handler);
  },
  onE2EDone: (cb: (data: { ok: boolean; error?: string }) => void): (() => void) => {
    const handler = (_e: unknown, data: { ok: boolean; error?: string }): void => cb(data);
    ipcRenderer.on("e2e:done", handler);
    return () => ipcRenderer.removeListener("e2e:done", handler);
  },
  prompt: (text: string): Promise<void> => ipcRenderer.invoke("engine:prompt", { text }),
  // 设置（T1.2 布局持久化；T1.1 正式化口径同 engine 域）
  settingsGet: (): Promise<Record<string, unknown>> => ipcRenderer.invoke("settings:get"),
  settingsSet: (patch: Record<string, unknown>): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke("settings:set", patch),
  // T1.3/T1.4 引擎与数据域
  engineStart: (projectDir: string): Promise<boolean> =>
    ipcRenderer.invoke("engine:start", { projectDir }),
  engineSteer: (text: string): Promise<void> => ipcRenderer.invoke("engine:steer", { text }),
  engineFollowUp: (text: string): Promise<void> => ipcRenderer.invoke("engine:followUp", { text }),
  engineAbort: (): Promise<void> => ipcRenderer.invoke("engine:abort"),
  engineNewSession: (): Promise<void> => ipcRenderer.invoke("engine:newSession"),
  engineModels: (): Promise<Array<{ provider: string; id: string }>> =>
    ipcRenderer.invoke("engine:getAvailableModels"),
  projectList: (): Promise<unknown> => ipcRenderer.invoke("project:list"),
  projectAdd: (path: string): Promise<unknown> => ipcRenderer.invoke("project:add", { path }),
  projectPick: (): Promise<string | undefined> => ipcRenderer.invoke("project:pickDialog"),
  projectTrust: (path: string): Promise<string> => ipcRenderer.invoke("project:trustStatus", { path }),
  sessionsList: (path: string): Promise<unknown> => ipcRenderer.invoke("sessions:list", { path }),
  sessionsTree: (file: string): Promise<unknown> => ipcRenderer.invoke("sessions:tree", { file }),
  sessionsMessages: (file: string): Promise<unknown> =>
    ipcRenderer.invoke("sessions:messages", { file }),
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
};

export type PiPreloadApi = typeof api;

contextBridge.exposeInMainWorld("pi", api);
