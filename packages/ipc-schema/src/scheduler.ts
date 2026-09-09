import { z } from "zod";

/**
 * T7.8 定时任务（Scheduled Tasks）IPC 契约。
 * loop 文件 frontmatter 为源真（文件源任务编辑走 loop 文件端点）；manual 任务定义存 state。
 */

export const ScheduledRunStatusSchema = z.enum(["ok", "error", "skipped"]);
export type ScheduledRunStatus = z.infer<typeof ScheduledRunStatusSchema>;

export const ScheduledRunRecordSchema = z.object({
  lastRunAt: z.number().optional(),
  nextRunAt: z.number().optional(),
  lastStatus: ScheduledRunStatusSchema.optional(),
  lastError: z.string().optional(),
  lastSessionId: z.string().optional(),
  lastDurationMs: z.number().optional(),
  lastScheduledFor: z.number().optional(),
});
export type ScheduledRunRecordView = z.infer<typeof ScheduledRunRecordSchema>;

export const ScheduledTaskViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  schedule: z.string(), // cron 5 段
  enabled: z.boolean(),
  model: z.string().optional(),
  agent: z.string().optional(),
  timezone: z.string().optional(),
  prompt: z.string(),
  source: z.enum(["file", "manual"]),
  filePath: z.string().optional(),
  projectDir: z.string().optional(),
  run: ScheduledRunRecordSchema,
});
export type ScheduledTaskView = z.infer<typeof ScheduledTaskViewSchema>;

/** 新建/编辑任务的输入。 */
export const ScheduledTaskInputSchema = z.object({
  id: z.string().optional(), // 更新时带
  name: z.string(),
  schedule: z.string(),
  enabled: z.boolean(),
  model: z.string().optional(),
  agent: z.string().optional(),
  timezone: z.string().optional(),
  prompt: z.string(),
  projectDir: z.string().optional(),
});
export type ScheduledTaskInput = z.infer<typeof ScheduledTaskInputSchema>;

export const SCHEDULER_CHANNELS = {
  list: "scheduler:list", // → ScheduledTaskView[]
  save: "scheduler:save", // input（有 id=更新）→ {id?} | {error}
  remove: "scheduler:remove", // {id} → {error?}
  runNow: "scheduler:runNow", // {id} → {error?}
} as const;
