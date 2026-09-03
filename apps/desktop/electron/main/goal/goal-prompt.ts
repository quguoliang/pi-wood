/**
 * T7.5 目标模式：审计 / 续跑 prompt 构造 + 审计结果解析（纯函数、可单测）。
 * 审计只看「目标正文 + 最后一轮助手回复」（不带全史，省 token）；解析容错代码围栏/前后夹杂文本。
 */
import type { GoalAuditVerdict, GoalState } from "@pi-wood/ipc-schema";

export interface AuditResult {
  verdict: GoalAuditVerdict;
  note?: string;
}

/** 小模型审计 prompt：强制只输出 JSON。 */
export function buildAuditPrompt(objective: string, lastAssistant: string): string {
  const excerpt = lastAssistant.length > 4000 ? `${lastAssistant.slice(0, 4000)}…` : lastAssistant;
  return [
    "你是目标模式的进度审计器。仅依据「目标」与「助手最近一轮回复」判断目标整体进展。",
    "只输出一个 JSON 对象，不要任何额外文字，格式与取值严格如下：",
    '{"verdict":"complete"|"continue"|"blocked","note":"≤120字的简短中文说明"}',
    "- complete：目标已完全达成且可验证。",
    "- blocked：明显受阻/无法推进（缺信息、方向错误、反复失败），需要用户介入。",
    "- continue：仍在推进、还应继续。",
    "",
    "目标：",
    objective.trim(),
    "",
    "助手最近一轮回复：",
    excerpt.trim() || "(空)",
  ].join("\n");
}

/**
 * 解析审计输出。宽松提取第一个 JSON 对象；verdict 非法/无法解析 → undefined（判为审计失败）。
 */
export function parseAudit(raw: string): AuditResult | undefined {
  if (!raw) return undefined;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  let obj: unknown;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return undefined;
  }
  const o = obj as { verdict?: unknown; note?: unknown };
  const v = o.verdict;
  if (v !== "complete" && v !== "continue" && v !== "blocked") return undefined;
  const note = typeof o.note === "string" ? o.note : undefined;
  return { verdict: v, note };
}

/** 自动续跑 prompt：带目标、预算与每轮末尾事实报告要求。 */
export function buildContinuationPrompt(objective: string, state: GoalState): string {
  const remainingTurns = Math.max(0, state.maxTurns - state.turnsUsed);
  const remainingTokens = Math.max(0, state.tokenBudget - state.tokensUsed);
  return [
    "【目标模式 · 自动续跑】你在持续自主完成下面这个目标，无需等待用户确认下一步。",
    "",
    "目标：",
    objective.trim(),
    "",
    `预算：剩余约 ${remainingTokens} tokens、${remainingTurns} 轮自动续跑。`,
    "要求：",
    "1) 本轮只做达成目标的下一步必要动作（读/改/跑），不要空谈计划。",
    "2) 若目标已完全达成，明确说「目标已完成」并给出验证依据。",
    "3) 每轮结尾用一行给出事实报告：DONE:<已完成> | VERIFIED:<如何验证> | REMAINING:<还差什么>。",
  ].join("\n");
}

/** 首次设目标时随目标正文一起发出的启动 prompt（把目标交给主 agent 开跑）。 */
export function buildKickoffPrompt(objective: string): string {
  return ["【目标模式】请自主推进并最终完成以下目标（我会据进度自动续跑，尽量每轮都有实质动作）。", "", "目标：", objective.trim()].join("\n");
}
