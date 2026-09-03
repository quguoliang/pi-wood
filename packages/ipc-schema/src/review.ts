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

export const REVIEW_CHANNELS = {
  run: "review:run", // renderer → main
} as const;
