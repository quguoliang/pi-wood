import { contextBridge, ipcRenderer } from "electron";

const api = {
  ping: (): Promise<{ pong: boolean; electron: string; node: string }> =>
    ipcRenderer.invoke("app:ping"),
};

export type PiPreloadApi = typeof api;

contextBridge.exposeInMainWorld("pi", api);
