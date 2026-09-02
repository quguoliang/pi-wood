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

/** 折叠成一行、限长。 */
function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
const asStr = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/** 默认摘要：把入参摊成几行 key: value（而非原始 JSON）。 */
function summarizeInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input).filter(([, v]) => v != null && v !== "");
  if (entries.length === 0) return "(无参数)";
  const lines = entries.slice(0, 6).map(([k, v]) => {
    const val = Array.isArray(v) ? `${v.length} 项` : typeof v === "object" ? oneLine(JSON.stringify(v), 80) : asStr(v);
    return `${k}: ${oneLine(val, 100)}`;
  });
  if (entries.length > 6) lines.push(`… 还有 ${entries.length - 6} 项`);
  return lines.join("\n");
}

/**
 * 把一次工具调用翻成审批卡的友好标题 + 摘要（替代原始 JSON）。
 * 父审批门与子代理审批门共用。
 */
export function describeApprovalCall(toolName: string, input: unknown): { title: string; message: string } {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case "bash":
      return { title: "运行命令？", message: asStr(i.command) || "(无命令)" };
    case "powershell":
      return { title: "运行 PowerShell 命令？", message: asStr(i.command) || "(无命令)" };
    case "edit": {
      const edits = Array.isArray(i.edits) ? (i.edits as Array<Record<string, unknown>>) : [];
      const lines = [`文件：${asStr(i.path)}`];
      for (const e of edits.slice(0, 4)) {
        const o = oneLine(asStr(e.oldText), 70);
        const n = oneLine(asStr(e.newText), 70);
        if (o) lines.push(`− ${o}`);
        if (n) lines.push(`+ ${n}`);
      }
      if (edits.length > 4) lines.push(`… 还有 ${edits.length - 4} 处修改`);
      return { title: "编辑文件？", message: lines.join("\n") };
    }
    case "write": {
      const content = asStr(i.content);
      const contentLines = content.split("\n");
      const preview = contentLines.slice(0, 6).join("\n");
      return {
        title: "写入文件？",
        message: `文件：${asStr(i.path)}\n${preview}${contentLines.length > 6 ? `\n… 共 ${contentLines.length} 行` : ""}`,
      };
    }
    default:
      if (toolName.startsWith("browser_")) {
        return { title: "浏览器操作？", message: asStr(i.url) || summarizeInput(i) };
      }
      return { title: `执行 ${toolName}？`, message: summarizeInput(i) };
  }
}

/** inline extension 工厂（经 resourceLoaderOptions.extensionFactories 注入） */
export function permissionGateExtension(
  getPolicy: () => ApprovalPolicy,
  confirm: (title: string, message: string, toolName?: string) => Promise<boolean>,
  isAutoAccept?: () => boolean,
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
        // T7.2：当前会话开启自动接受时，把「需确认」直接升级为「允许」，不弹审批卡。
        // 只在 ask 分支生效 → denyAll / path-guard 的 deny 永不被绕过（安全底线）。
        if (isAutoAccept?.()) return;
        const { title, message } = describeApprovalCall(event.toolName, event.input);
        const ok = await (ctx?.ui?.confirm ?? confirm)(title, message, event.toolName);
        if (!ok) return { block: true, reason: "用户拒绝该操作" };
        return;
      });
    },
  };
}
