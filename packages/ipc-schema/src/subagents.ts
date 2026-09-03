import { z } from "zod";

/**
 * T6.7 子代理 per-tool 权限（方案 §7.7）IPC 契约 —— 主进程 ↔ 设置「子代理」页。
 * 权限覆盖按 agent profile 名索引，存于 pi-wood settings.subagentPermissions（非 agent frontmatter，
 * 因 vendored profile 校验会拒未知 frontmatter 键）。
 */

export const ToolPermissionActionSchema = z.enum(["allow", "ask", "deny"]);
export type ToolPermissionAction = z.infer<typeof ToolPermissionActionSchema>;

/** 可配置的审批敏感工具（child guard 已包 bash/edit/write；read/grep/find/ls 供收紧）。 */
export const SUBAGENT_TOOL_KEYS = ["bash", "edit", "write", "read", "grep", "find", "ls"] as const;
export type SubagentToolKey = (typeof SUBAGENT_TOOL_KEYS)[number];

/** 单个子代理 profile 的展示信息（列表 = ~/.pi/agent/agents 扫到 ∪ settings 里已配置过的）。 */
export const SubagentProfileInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  /** 是否在 agents 目录里存在有效 profile（false=仅历史配置残留，可清）。 */
  inAgentsDir: z.boolean(),
  /** 当前 per-tool 覆盖（仅含被显式配置的工具；未含者=继承父全局策略）。 */
  permissions: z.record(z.string(), ToolPermissionActionSchema),
});
export type SubagentProfileInfo = z.infer<typeof SubagentProfileInfoSchema>;

export const SUBAGENT_CHANNELS = {
  listProfiles: "subagents:listProfiles",
  /** 设置某 agent 某工具的权限档 */
  setPermission: "subagents:setPermission",
  /** 清除某 agent 的全部覆盖（回退继承） */
  clearPermissions: "subagents:clearPermissions",
} as const;
