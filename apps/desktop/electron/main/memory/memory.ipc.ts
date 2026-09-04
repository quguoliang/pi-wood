import { join } from "node:path";
import { ipcMain } from "electron";
import { MEMORY_CHANNELS, type MemoryItem, type MemoryListResult } from "@pi-wood/ipc-schema";
import { configureMemoryService } from "./memory-service.ts";
import { getActiveWorkspaceDir } from "../engine/engine-manager.ts";
import { mainProjectRootOf } from "../worktree/worktree-naming.ts";
import { fileWriteQueue } from "../workbench/write-queue.ts";

/** 与 settings-service 同源的 ~/.pi-wood。 */
function appDataDir(): string {
  return join(process.env["USERPROFILE"] ?? process.env["HOME"] ?? ".", ".pi-wood");
}

/**
 * T7.10 Agent Memory 管理页后端：configure 服务（注入 appDataDir + 活动项目 getter）并注册通道。
 * 工具侧（agent-tools/memory-tools）走同一个 MemoryService 单例（getMemoryService）。
 */
export function initMemoryIpc(): void {
  const service = configureMemoryService({
    appDataDir: appDataDir(),
    // T8.7 记忆 scope 归一（补 T7.10 偏差 b）：worktree 对话的记忆归到主项目根同一份
    // project.json，否则每对话各写一份被切碎
    getProjectDir: () => {
      const dir = getActiveWorkspaceDir();
      return dir ? mainProjectRootOf(dir) : undefined;
    },
  });

  ipcMain.handle(MEMORY_CHANNELS.list, (): MemoryListResult => service.list());
  // T8.7 写并发保护：memory 是 read-modify-write 全量覆盖，两对话并发 save/update/delete
  // 一律进 per-file 串行临界区（多对话并发下不丢条目）
  ipcMain.handle(MEMORY_CHANNELS.save, (_e, raw: unknown): Promise<MemoryItem | null> =>
    fileWriteQueue.withLock("memory", () => {
      const a = (raw ?? {}) as Record<string, unknown>;
      const r = service.save({ title: a.title, body: a.body, scope: a.scope, type: a.type });
      return Promise.resolve(r.item);
    }));
  ipcMain.handle(MEMORY_CHANNELS.update, (_e, raw: unknown): Promise<MemoryItem | null> =>
    fileWriteQueue.withLock("memory", () => {
      const a = (raw ?? {}) as { id?: unknown; title?: unknown; body?: unknown; type?: unknown };
      if (typeof a.id !== "string") return Promise.resolve(null);
      const s = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
      return Promise.resolve(service.edit(a.id, { title: s(a.title), body: s(a.body), type: s(a.type) }).item);
    }));
  ipcMain.handle(MEMORY_CHANNELS.setReviewed, (_e, raw: unknown): Promise<boolean> =>
    fileWriteQueue.withLock("memory", () => {
      const a = (raw ?? {}) as { id?: unknown; reviewed?: unknown };
      return Promise.resolve(typeof a.id === "string" ? service.markReviewed(a.id, a.reviewed === true) : false);
    }));
  ipcMain.handle(MEMORY_CHANNELS.delete, (_e, raw: unknown): Promise<boolean> =>
    fileWriteQueue.withLock("memory", () => {
      const id = (raw as { id?: unknown } | undefined)?.id;
      return Promise.resolve(typeof id === "string" ? service.remove(id) : false);
    }));
}
