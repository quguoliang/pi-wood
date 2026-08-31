import { z } from "zod";

/**
 * 审批门策略（T4.1，方案 §9/§10.3）。
 * 四档模式（方案口径）+ 规则覆盖；以 inline extension 注入 Pi（不写用户目录）。
 */
export const ApprovalPolicySchema = z.object({
  mode: z.enum(["auto", "highRisk", "allAsk", "denyAll"]).default("highRisk"),
  /** 规则按顺序匹配，先命中先生效；pattern 匹配 "工具名+入参JSON" */
  rules: z
    .array(
      z.object({
        pattern: z.string().min(1),
        action: z.enum(["allow", "ask", "deny"]),
      }),
    )
    .default([]),
});
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;

export const DEFAULT_POLICY: ApprovalPolicy = {
  mode: "highRisk",
  rules: [],
};

const HIGH_RISK_TOOLS = new Set(["bash", "edit", "write"]);

const SENSITIVE_PATH = /(^|[\\/])(\.env|\.git[\\/]|node_modules[\\/]|\.ssh[\\/])|(\.ssh[\\/]id_|\.env$)/i;

export type Decision = "allow" | "ask" | "deny";

export function decide(policy: ApprovalPolicy, toolName: string, input: unknown): Decision {
  if (toolName === "read" || toolName === "ls" || toolName === "find" || toolName === "grep") {
    // 只读工具默认放行（除非规则显式命中）
    const hit = matchRules(policy, toolName, input);
    return hit ?? "allow";
  }
  // 敏感文件写保护（§9 path-guard）：.env / .git / node_modules / .ssh
  const inputText = JSON.stringify(input ?? {});
  if ((toolName === "edit" || toolName === "write") && SENSITIVE_PATH.test(inputText)) {
    return "deny";
  }
  const hit = matchRules(policy, toolName, input);
  if (hit) return hit;

  switch (policy.mode) {
    case "auto":
      return "allow";
    case "denyAll":
      return "deny";
    case "allAsk":
      return "ask";
    case "highRisk":
    default:
      return HIGH_RISK_TOOLS.has(toolName) ? "ask" : "allow";
  }
}

function matchRules(policy: ApprovalPolicy, toolName: string, input: unknown): Decision | undefined {
  const hay = `${toolName} ${JSON.stringify(input ?? {})}`;
  for (const rule of policy.rules ?? []) {
    try {
      if (new RegExp(rule.pattern, "i").test(hay)) return rule.action;
    } catch {
      /* 非法正则跳过 */
    }
  }
  return undefined;
}

/** inline extension 工厂（经 resourceLoaderOptions.extensionFactories 注入） */
export function permissionGateExtension(
  getPolicy: () => ApprovalPolicy,
  confirm: (title: string, message: string) => Promise<boolean>,
): { name: string; factory: (pi: unknown) => void } {
  return {
    name: "piwood-permission-gate",
    factory: (pi: any) => {
      pi.on("tool_call", async (event: any, ctx: any) => {
        const policy = getPolicy();
        const decision = decide(policy, event.toolName, event.input);
        if (decision === "allow") return;
        if (decision === "deny") {
          return { block: true, reason: "已由安全策略拦截（path-guard / denyAll）" };
        }
        const summary = JSON.stringify(event.input ?? {}).slice(0, 300);
        const ok = await (ctx?.ui?.confirm ?? confirm)(
          `允许执行 ${event.toolName}？`,
          summary || "(无参数)",
        );
        if (!ok) return { block: true, reason: "用户拒绝该操作" };
        return;
      });
    },
  };
}
