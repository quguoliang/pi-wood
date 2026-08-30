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
};

export type PiPreloadApi = typeof api;

contextBridge.exposeInMainWorld("pi", api);
