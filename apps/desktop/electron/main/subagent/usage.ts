/**
 * T6.6 子代理成本汇总（纯函数，无 electron / vendor 运行时依赖，可单测）。
 *
 * 数据源是活跃 parent 会话的子代理运行注册表 `rt.runs.list()`（每个 RunView 现携带 usage）。
 * 说明：goofansu vendored 内核 `MAX_SUBAGENT_DEPTH = 1` —— 子代理进程内扩展 inert，
 * child 无法再 spawn，故委派树结构上就是「一层扁平」。本聚合对注册表内**所有** run 求和，
 * 这已等价于「含嵌套」的递归汇总（若有朝一日放开深度，同一 in-process runtime 仍会枚举到
 * 每一层的 run，扁平求和依旧完整正确），因此无需显式按 parent id 递归。
 */

/** 与 vendored `RunView.usage` 结构化对齐（仅取聚合所需字段，不引 vendor 类型以免牵连运行时 import）。 */
export interface RunUsageInput {
  id: string;
  agent: string;
  elapsedMs: number;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    contextTokens: number;
    turns: number;
  };
}

export interface SubagentChildUsage {
  id: string;
  agentName: string;
  tokens: number;
  cost: number;
  elapsedMs: number;
}

export interface SubagentUsage {
  tokens: number;
  cost: number;
  count: number;
  perChild: SubagentChildUsage[];
}

const safe = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);
// 费用为美元小数（如 0.0011），累加有浮点尾噪 → 归到 6 位小数。
const roundCost = (n: number): number => Math.round(n * 1e6) / 1e6;

/** 空注册表 → undefined（渲染层据此不显示子代理消耗行）。 */
export function aggregateRunUsage(runs: readonly RunUsageInput[]): SubagentUsage | undefined {
  if (!runs || runs.length === 0) return undefined;
  let tokens = 0;
  let cost = 0;
  const perChild: SubagentChildUsage[] = runs.map((r) => {
    const t = safe(r.usage?.input) + safe(r.usage?.output);
    const c = Number.isFinite(r.usage?.cost) && r.usage.cost > 0 ? r.usage.cost : 0;
    tokens += t;
    cost += c;
    return {
      id: r.id,
      agentName: r.agent ?? "subagent",
      tokens: t,
      cost: roundCost(c),
      elapsedMs: Math.max(0, r.elapsedMs ?? 0),
    };
  });
  return { tokens, cost: roundCost(cost), count: perChild.length, perChild };
}
