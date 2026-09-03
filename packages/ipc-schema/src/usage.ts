import { z } from "zod";

/**
 * T7.12 用量/配额追踪（per-provider）IPC 契约。与主进程 provider/usage-core.ts 的读视图结构一致。
 */

export const UsageTokensSchema = z.object({ input: z.number(), output: z.number(), total: z.number() });
export type UsageTokens = z.infer<typeof UsageTokensSchema>;

export const UsageEntrySchema = z.object({
  providerId: z.string(),
  modelId: z.string(),
  tokens: UsageTokensSchema,
  cost: z.number(),
});
export type UsageEntry = z.infer<typeof UsageEntrySchema>;

export const ProviderTotalSchema = z.object({
  providerId: z.string(),
  tokens: UsageTokensSchema,
  cost: z.number(),
});
export type ProviderTotal = z.infer<typeof ProviderTotalSchema>;

export const QuotaWarningSchema = z.object({
  providerId: z.string(),
  overTokens: z.boolean(),
  overCost: z.boolean(),
});
export type QuotaWarning = z.infer<typeof QuotaWarningSchema>;

export const ProviderQuotaSchema = z.object({
  monthlyTokenBudget: z.number().optional(),
  monthlyCostBudget: z.number().optional(),
});
export type ProviderQuota = z.infer<typeof ProviderQuotaSchema>;

export const UsageViewSchema = z.object({
  month: z.string(),
  entries: z.array(UsageEntrySchema),
  totals: z.array(ProviderTotalSchema),
  warnings: z.array(QuotaWarningSchema),
  quota: z.record(z.string(), ProviderQuotaSchema),
});
export type UsageView = z.infer<typeof UsageViewSchema>;
