import { z } from "zod";

/**
 * T7.10 Agent Memory IPC 契约（方案 §7.8）。条目存储/裁剪逻辑在 memory/store.ts + memory-service.ts；
 * 这里只定义渲染层管理页 ↔ 主进程的数据形状与通道。
 */

export const MemoryTypeSchema = z.enum(["fact", "preference", "reference"]);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;
export const MemoryScopeSchema = z.enum(["global", "project"]);
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const MemoryItemSchema = z.object({
  id: z.string(),
  type: MemoryTypeSchema,
  title: z.string(),
  body: z.string(),
  scope: MemoryScopeSchema,
  createdAt: z.number(),
  reviewed: z.boolean(),
});
export type MemoryItem = z.infer<typeof MemoryItemSchema>;

export const MemoryListResultSchema = z.object({
  global: z.array(MemoryItemSchema),
  project: z.array(MemoryItemSchema),
});
export type MemoryListResult = z.infer<typeof MemoryListResultSchema>;

export const MEMORY_CHANNELS = {
  list: "memory:list",
  save: "memory:save", // 用户在管理页手动新增
  update: "memory:update",
  setReviewed: "memory:setReviewed",
  delete: "memory:delete",
} as const;
