import { BrowserWindow, app, ipcMain } from "electron";
import { PLUGIN_CHANNELS } from "@pi-wood/ipc-schema";
import { getActiveWorkspaceDir, uiBridge } from "../engine/engine-manager.ts";
import { browserNavigate, browserScreenshot } from "../workbench/browser-service.ts";
import { getSettings, updateSettings } from "../settings-service.ts";
import { PluginHost, type PluginHostServices } from "./plugin-host.ts";

let host: PluginHost | undefined;

function firstWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0];
}

function buildServices(sendToRenderer: (channel: string, data: unknown) => void): PluginHostServices {
  const bridge = uiBridge();
  return {
    appPath: app.getAppPath(),
    sendToRenderer,
    // T8.7：插件的活动项目语义 = 当前对话的 worktree（插件宿主无对话上下文，取 active 对话；语义在此写明）
    getProjectDir: () => getActiveWorkspaceDir(),
    ui: {
      notify: (message, type) => bridge.notify(message, type),
      confirm: (title, message) => bridge.confirm(title, message),
      select: (title, options) => bridge.select(title, options),
      input: (title, placeholder) => bridge.input(title, placeholder),
    },
    window: {
      setTitle: (title) => {
        const win = firstWindow();
        if (win) win.setTitle(title);
        else void title; // utilityProcess 无窗口时忽略
      },
      setProgress: (progress) => firstWindow()?.setProgressBar(progress ?? -1),
    },
    browser: {
      navigate: (url) => browserNavigate(url),
      screenshot: () => browserScreenshot(),
    },
    invokeAgentTool: async (name, args) => {
      if (name.startsWith("browser_")) {
        const a = (args ?? {}) as { url?: string };
        if (name === "browser_navigate" && a.url) {
          await browserNavigate(a.url);
          return { ok: true };
        }
        if (name === "browser_screenshot") return { screenshot: await browserScreenshot() };
        return { ok: false, error: `browser 工具 ${name} 暂未直连（预留）` };
      }
      // 通用 agent 工具执行需活动会话内的工具句柄，T5.2 预留：仍受 agentTool:invoke 权限门约束。
      return { ok: false, error: `invokeAgentTool(${name}) 预留：宿主当前未直连通用工具执行` };
    },
    getEnabledMap: () => getSettings().pluginsEnabled,
    persistEnabled: (id, enabled) => {
      updateSettings({ pluginsEnabled: { [id]: enabled } });
    },
  };
}

export function initPluginsIpc(sendToRenderer: (channel: string, data: unknown) => void): void {
  host = new PluginHost(buildServices(sendToRenderer));

  ipcMain.handle(PLUGIN_CHANNELS.list, () => host?.statusList() ?? []);
  ipcMain.handle(PLUGIN_CHANNELS.setEnabled, (_e, raw: { id?: string; enabled?: boolean }) => {
    if (raw?.id && typeof raw.enabled === "boolean") host?.setEnabled(raw.id, raw.enabled);
    return host?.statusList() ?? [];
  });
  ipcMain.handle(PLUGIN_CHANNELS.restart, (_e, raw: { id?: string }) => {
    if (raw?.id) host?.restart(raw.id);
    return host?.statusList() ?? [];
  });
  ipcMain.handle(PLUGIN_CHANNELS.reload, () => {
    host?.reload();
    return host?.statusList() ?? [];
  });
  ipcMain.handle(PLUGIN_CHANNELS.demo, (_e, raw: { kind?: string }) => {
    const kind = raw?.kind === "overreach" ? "overreach" : "crash";
    return { triggered: host ? host.demo(kind) : false, kind };
  });

  // 延迟一拍拉起，让窗口先创建（renderer 挂载后也会主动 plugins:list 拉初值）
  setTimeout(() => host?.loadAndStart(), 300);
}

export function stopAllPlugins(): void {
  try {
    host?.stopAll();
  } catch {
    /* 退出清理，忽略 */
  }
}
