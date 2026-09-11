import { z } from "zod";

/**
 * T7.7 代码审查流（方案 §7.8 / OpenChamber reviewFlow）IPC 契约。
 * 审查=对活动项目 `git diff HEAD` 跑一次隔离小模型，产出结构化发现列表，供渲染层点跳文件行 / 应用建议。
 */

export const ReviewSeveritySchema = z.enum(["error", "warning", "info"]);
export type ReviewSeverity = z.infer<typeof ReviewSeveritySchema>;

export const FindingSchema = z.object({
  file: z.string(),
  line: z.number().int().nonnegative().optional(),
  severity: ReviewSeveritySchema,
  message: z.string(),
  suggestion: z.string().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const ReviewResultSchema = z.object({
  findings: z.array(FindingSchema),
  diffChars: z.number(), // 送审 diff 文本长度
  empty: z.boolean(), // 无变更（git diff 空）→ 前端空态
  error: z.string().optional(), // 引擎/模型/git 侧错误的友好文案
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

/** 工作区单文件变更：status 为 git porcelain XY（未跟踪 "??"）；before/after 为 HEAD/工作区全文（二进制或超大时留空并置标记）。 */
export const WorkingDiffFileSchema = z.object({
  path: z.string(),
  status: z.string(),
  added: z.number(),
  deleted: z.number(),
  binary: z.boolean(),
  truncated: z.boolean(),
  before: z.string(),
  after: z.string(),
});
export type WorkingDiffFile = z.infer<typeof WorkingDiffFileSchema>;

/** 活动工作区相对 HEAD 的原始 diff（「查看变更」用，独立于 AI 审查）。 */
export const WorkingDiffSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  branch: z.string().optional(),
  files: z.array(WorkingDiffFileSchema),
});
export type WorkingDiff = z.infer<typeof WorkingDiffSchema>;

export const REVIEW_CHANNELS = {
  run: "review:run", // renderer → main
  workingDiff: "review:workingDiff", // renderer → main：拉工作区相对 HEAD 的逐文件 diff
} as const;
