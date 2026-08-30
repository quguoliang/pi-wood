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
};

export type PiPreloadApi = typeof api;

contextBridge.exposeInMainWorld("pi", api);
