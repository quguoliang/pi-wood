import { BrowserWindow, ipcMain, screen } from "electron";

/** Windows/Linux 无边框窗口的自绘窗口控制 IPC；macOS 自绘红绿灯也复用（含半屏平铺）。 */
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
  // 自绘红绿灯绿键：与原生一致走全屏（非最大化）
  ipcMain.handle("win:fullscreenToggle", () => {
    const win = getWin();
    if (!win) return;
    win.setFullScreen(!win.isFullScreen());
  });
  // 绿键 hover 菜单：对齐原生「移动与调整大小 / 填充与排列」平铺集合
  ipcMain.handle("win:setTile", (_e, tile: "left" | "right" | "top" | "bottom" | "fill" | "left23" | "right23" | "quadTL") => {
    const win = getWin();
    if (!win) return;
    if (tile === "fill") {
      if (!win.isMaximized()) win.maximize();
      return;
    }
    if (win.isMaximized()) win.unmaximize();
    const { workArea: a } = screen.getDisplayMatching(win.getBounds());
    const set = (x: number, y: number, w: number, h: number): void => win.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) });
    switch (tile) {
      case "left": set(a.x, a.y, a.width / 2, a.height); break;
      case "right": set(a.x + a.width / 2, a.y, a.width / 2, a.height); break;
      case "top": set(a.x, a.y, a.width, a.height / 2); break;
      case "bottom": set(a.x, a.y + a.height / 2, a.width, a.height / 2); break;
      case "left23": set(a.x, a.y, (a.width * 2) / 3, a.height); break;
      case "right23": set(a.x + a.width / 3, a.y, (a.width * 2) / 3, a.height); break;
      case "quadTL": set(a.x, a.y, a.width / 2, a.height / 2); break;
    }
  });
  // 除当前所在屏之外的显示器列表（菜单「移到 …」行）
  ipcMain.handle("win:listDisplays", () => {
    const win = getWin();
    const cur = win ? screen.getDisplayMatching(win.getBounds()).id : -1;
    return screen.getAllDisplays().filter((d) => d.id !== cur).map((d) => ({ id: d.id, label: d.label || `显示器 ${d.id}` }));
  });
  ipcMain.handle("win:moveToDisplay", (_e, id: number) => {
    const win = getWin();
    if (!win) return;
    const d = screen.getAllDisplays().find((x) => x.id === id);
    if (!d) return;
    const b = win.getBounds();
    win.setBounds({
      x: d.workArea.x + Math.round((d.workArea.width - b.width) / 2),
      y: d.workArea.y + Math.round((d.workArea.height - b.height) / 2),
      width: b.width,
      height: b.height,
    });
  });
}
