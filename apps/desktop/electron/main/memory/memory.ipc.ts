import { join } from "node:path";
import { ipcMain } from "electron";
import { MEMORY_CHANNELS, type MemoryItem, type MemoryListResult } from "@pi-wood/ipc-schema";
import { configureMemoryService } from "./memory-service.ts";
import { getActiveProjectDirSafe } from "../engine/engine-manager.ts";

/** 与 settings-service 同源的 ~/.pi-wood。 */
function appDataDir(): string {
  return join(process.env["USERPROFILE"] ?? process.env["HOME"] ?? ".", ".pi-wood");
}

/**
 * T7.10 Agent Memory 管理页后端：configure 服务（注入 appDataDir + 活动项目 getter）并注册通道。
 * 工具侧（agent-tools/memory-tools）走同一个 MemoryService 单例（getMemoryService）。
 */
export function initMemoryIpc(): void {
  const service = configureMemoryService({ appDataDir: appDataDir(), getProjectDir: () => getActiveProjectDirSafe() });

  ipcMain.handle(MEMORY_CHANNELS.list, (): MemoryListResult => service.list());
  ipcMain.handle(MEMORY_CHANNELS.save, (_e, raw: unknown): MemoryItem | null => {
    const a = (raw ?? {}) as Record<string, unknown>;
    const r = service.save({ title: a.title, body: a.body, scope: a.scope, type: a.type });
    return r.item;
  });
  ipcMain.handle(MEMORY_CHANNELS.update, (_e, raw: unknown): MemoryItem | null => {
    const a = (raw ?? {}) as { id?: unknown; title?: unknown; body?: unknown; type?: unknown };
    if (typeof a.id !== "string") return null;
    const s = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
    return service.edit(a.id, { title: s(a.title), body: s(a.body), type: s(a.type) }).item;
  });
  ipcMain.handle(MEMORY_CHANNELS.setReviewed, (_e, raw: unknown): boolean => {
    const a = (raw ?? {}) as { id?: unknown; reviewed?: unknown };
    return typeof a.id === "string" ? service.markReviewed(a.id, a.reviewed === true) : false;
  });
  ipcMain.handle(MEMORY_CHANNELS.delete, (_e, raw: unknown): boolean => {
    const id = (raw as { id?: unknown } | undefined)?.id;
    return typeof id === "string" ? service.remove(id) : false;
  });
}
