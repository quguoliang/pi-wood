import { app, shell, BrowserWindow, ipcMain } from "electron";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { isExtensionProbeMode, runExtensionProbe } from "./extension-probe";
import { isE2EMode, startE2E } from "./engine/e2e-service";
import { initSettingsIpc } from "./settings-service";
import { initDataIpc } from "./ipc/data.ipc";
import { initEngineIpc, getActiveProjectDir, getActiveProjectDirSafe } from "./engine/engine-manager";
import { initFileIpc } from "./workbench/file-service";
import { initTerminalIpc, killAllTerminals } from "./workbench/terminal-service";
import { initBrowserIpc } from "./workbench/browser-service";

let mainWindowRef: BrowserWindow | undefined;
function sendToRenderer(channel: string, data: unknown): void {
  mainWindowRef?.webContents.send(channel, data);
}

const debugLog = (line: string): void => {
  try {
    const f = join(app.getAppPath(), "docs", "proofs", "T0.3", "boot.log");
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* ignore */
  }
};

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: "PiDesk",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindowRef = win;

  win.on("ready-to-show", () => win.show());

  // 外链走系统浏览器，不在应用内开新窗
  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // T0.3 探针模式：窗口就绪后在主进程内跑扩展加载 + ctx.ui 桥验证
  if (isExtensionProbeMode()) {
    debugLog("probe mode on, waiting did-finish-load");
    const send = (channel: string, data: unknown) => win.webContents.send(channel, data);
    win.webContents.on("did-finish-load", () => {
      debugLog("did-finish-load fired");
      void runExtensionProbe(send);
    });
    win.webContents.on("did-fail-load", (_e, code, desc) => {
      debugLog(`did-fail-load: ${code} ${desc}`);
    });
  }

  // T0.6 门禁 E2E：Electron 内 "用 Pi 改一个文件"，事件 + diff 实时上屏
  if (isE2EMode()) {
    debugLog("e2e mode on");
    const send = (channel: string, data: unknown) => win.webContents.send(channel, data);
    win.webContents.on("did-finish-load", () => {
      debugLog("e2e did-finish-load, starting");
      startE2E(send);
    });
    win.webContents.on("did-fail-load", (_e, code, desc) => {
      debugLog(`e2e did-fail-load: ${code} ${desc}`);
    });
  }

  // T1.2 无干扰视觉验收：--capture <file> 渲染完成后截窗口内容（不需前台）
  const captureIdx = process.argv.indexOf("--capture");
  if (captureIdx !== -1 && process.argv[captureIdx + 1]) {
    const file = process.argv[captureIdx + 1] as string;
    win.webContents.on("did-finish-load", () => {
      setTimeout(() => {
        void win.webContents.capturePage().then((image) => {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, image.toPNG());
          debugLog(`captured ${file}`);
          // Pi SDK 静态引入后 app.quit() 会挂起（§8），探针/捕获路径用硬退出
          setTimeout(() => app.exit(0), 300);
        });
      }, 2500);
    });
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  debugLog(`boot: gotLock=true probe=${isExtensionProbeMode()}`);
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(async () => {
    // 渲染层 DOM 暴露给系统无障碍树（自动化测试/读屏支持）
    app.accessibilitySupportEnabled = true;
    ipcMain.handle("app:ping", () => ({
      pong: true,
      electron: process.versions.electron,
      node: process.versions.node,
    }));
    initSettingsIpc();
    // Pi ESM-only：agentDir 动态获取后再注册数据域 IPC（§8 规则：主进程禁止静态导入 Pi）
    const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
    initDataIpc(getAgentDir(), getActiveProjectDirSafe);
    initEngineIpc();
    initFileIpc(getActiveProjectDir);
    initTerminalIpc(sendToRenderer);
    initBrowserIpc();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    killAllTerminals();
    if (process.platform !== "darwin") {
      // Pi SDK 静态加载残留句柄可能挂起 quit（§8）；给 1.5s 后强制退出
      app.quit();
      setTimeout(() => app.exit(0), 1500);
    }
  });
}
