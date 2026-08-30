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
  prompt: (text: string): Promise<void> => ipcRenderer.invoke("engine:prompt", text),
};

export type PiPreloadApi = typeof api;

contextBridge.exposeInMainWorld("pi", api);
