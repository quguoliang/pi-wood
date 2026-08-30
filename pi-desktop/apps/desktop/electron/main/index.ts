import { app, shell, BrowserWindow, ipcMain } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { isExtensionProbeMode, runExtensionProbe } from "./extension-probe";

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
  const mainWindow = new BrowserWindow({
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

  mainWindow.on("ready-to-show", () => mainWindow.show());

  // 外链走系统浏览器，不在应用内开新窗
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // T0.3 探针模式：窗口就绪后在主进程内跑扩展加载 + ctx.ui 桥验证
  if (isExtensionProbeMode()) {
    debugLog("probe mode on, waiting did-finish-load");
    const send = (channel: string, data: unknown) => mainWindow.webContents.send(channel, data);
    mainWindow.webContents.on("did-finish-load", () => {
      debugLog("did-finish-load fired");
      void runExtensionProbe(send);
    });
    mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
      debugLog(`did-fail-load: ${code} ${desc}`);
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

  void app.whenReady().then(() => {
    ipcMain.handle("app:ping", () => ({
      pong: true,
      electron: process.versions.electron,
      node: process.versions.node,
    }));
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
