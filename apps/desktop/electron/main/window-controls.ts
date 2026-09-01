import { BrowserWindow, ipcMain } from "electron";

/** Windows/Linux 无边框窗口的自绘窗口控制 IPC（macOS 走系统红绿灯，不注册 UI 依赖）。 */
export function initWindowIpc(getWin: () => BrowserWindow | undefined): void {
  ipcMain.handle("win:minimize", () => getWin()?.minimize());
  ipcMain.handle("win:maximizeToggle", () => {
    const win = getWin();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle("win:close", () => getWin()?.close());
  ipcMain.handle("win:isMaximized", () => getWin()?.isMaximized() ?? false);
}
