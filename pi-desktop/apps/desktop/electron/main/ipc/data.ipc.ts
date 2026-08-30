import { ipcMain } from "electron";
import {
  PROJECT_CHANNELS,
  SESSION_CHANNELS,
  IdArgSchema,
  PathArgSchema,
  FileArgSchema,
} from "@pidesk/ipc-schema";
import { ProjectManager, DEFAULT_APP_DATA_DIR } from "../project/project-manager.ts";
import { listSessions, openSessionTree } from "../engine/session-service.ts";

/**
 * 左栏数据域 IPC（T1.4）：project:* / sessions:*。
 * 入参 zod 校验；渲染层错误以 Error 消息回传（electron-trpc 化前的简化口径）。
 * ⚠️ Pi ESM-only：agentDir 由调用方（index.ts 的启动函数）异步获取后传入。
 */
export function initDataIpc(agentDir: string): ProjectManager {
  const pm = new ProjectManager(DEFAULT_APP_DATA_DIR, agentDir);

  ipcMain.handle(PROJECT_CHANNELS.list, () => pm.list());
  ipcMain.handle(PROJECT_CHANNELS.add, (_e, raw: unknown) => {
    const { path } = PathArgSchema.parse(raw);
    return pm.add(path);
  });
  ipcMain.handle(PROJECT_CHANNELS.remove, (_e, raw: unknown) => {
    const { id } = IdArgSchema.parse(raw);
    return pm.remove(id);
  });
  ipcMain.handle(PROJECT_CHANNELS.trustStatus, (_e, raw: unknown) => {
    const { path } = PathArgSchema.parse(raw);
    return pm.trustStatus(path);
  });

  ipcMain.handle(SESSION_CHANNELS.list, (_e, raw: unknown) => {
    const { path } = PathArgSchema.parse(raw);
    return listSessions(path);
  });
  ipcMain.handle(SESSION_CHANNELS.tree, (_e, raw: unknown) => {
    const { file } = FileArgSchema.parse(raw);
    return openSessionTree(file);
  });

  return pm;
}
