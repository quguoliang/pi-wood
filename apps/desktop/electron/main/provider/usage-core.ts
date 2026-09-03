/**
 * T7.12 用量/配额追踪 —— 纯累计/裁剪/配额逻辑（无 fs / 无 electron，可穷举单测）。
 *
 * 归属模型：store = providerId → modelId → {input,output,total,cost}（同一月份桶）。
 * 月份由 monthKey(now) 决定，不同月份天然落到不同文件 → 跨月即「重置」（新月份从 0 起）。
 * 上层 UsageTracker 负责按「会话累计快照求差」把每轮新增 token/费用喂给 addDelta 并落盘。
 */

export interface UsageTokens {
  input: number;
  output: number;
  total: number;
}

export interface ModelUsage extends UsageTokens {
  cost: number;
}

/** providerId → modelId → 累计 */
export type UsageStore = Record<string, Record<string, ModelUsage>>;

export interface UsageEntry {
  providerId: string;
  modelId: string;
  tokens: UsageTokens;
  cost: number;
}

export interface ProviderQuota {
  monthlyTokenBudget?: number;
  monthlyCostBudget?: number;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** 月份桶键（UTC YYYY-MM）。跨月产生不同键 → 上层落不同文件 → 用量自然从 0 起。 */
export function monthKey(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

/** 解析存储 JSON（对象）；缺失/坏 JSON/非法 → 空表。 */
export function parseStore(raw: string | null | undefined): UsageStore {
  if (!raw || !raw.trim()) return {};
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out: UsageStore = {};
  for (const [pid, models] of Object.entries(obj as Record<string, unknown>)) {
    if (!models || typeof models !== "object") continue;
    const m: Record<string, ModelUsage> = {};
    for (const [mid, u] of Object.entries(models as Record<string, unknown>)) {
      if (!u || typeof u !== "object") continue;
      const e = u as Record<string, unknown>;
      m[mid] = { input: num(e.input), output: num(e.output), total: num(e.total), cost: num(e.cost) };
    }
    if (Object.keys(m).length > 0) out[pid] = m;
  }
  return out;
}

export function serializeStore(store: UsageStore): string {
  return JSON.stringify(store, null, 2);
}

export interface Delta {
  input: number;
  output: number;
  total: number;
  cost: number;
}

/** 把一次增量累加到 (providerId, modelId)；返回新对象（不可变）。负/非数增量归零、total 缺省=input+output。 */
export function addDelta(store: UsageStore, providerId: string, modelId: string, delta: Partial<Delta>): UsageStore {
  const dInput = num(delta.input);
  const dOutput = num(delta.output);
  const dTotal = num(delta.total) || dInput + dOutput;
  const dCost = num(delta.cost);
  if (!providerId || !modelId) return { ...store };
  if (dInput === 0 && dOutput === 0 && dTotal === 0 && dCost === 0) return { ...store };
  const prov = { ...(store[providerId] ?? {}) };
  const cur = prov[modelId] ?? { input: 0, output: 0, total: 0, cost: 0 };
  prov[modelId] = {
    input: cur.input + dInput,
    output: cur.output + dOutput,
    total: cur.total + dTotal,
    cost: cur.cost + dCost,
  };
  return { ...store, [providerId]: prov };
}

export function toEntries(store: UsageStore): UsageEntry[] {
  const out: UsageEntry[] = [];
  for (const [providerId, models] of Object.entries(store)) {
    for (const [modelId, u] of Object.entries(models)) {
      out.push({ providerId, modelId, tokens: { input: u.input, output: u.output, total: u.total }, cost: u.cost });
    }
  }
  return out.sort((a, b) => a.providerId.localeCompare(b.providerId) || a.modelId.localeCompare(b.modelId));
}

export interface ProviderTotal {
  providerId: string;
  tokens: UsageTokens;
  cost: number;
}

export function providerTotals(store: UsageStore): ProviderTotal[] {
  const out: ProviderTotal[] = [];
  for (const [providerId, models] of Object.entries(store)) {
    const t = { input: 0, output: 0, total: 0 };
    let cost = 0;
    for (const u of Object.values(models)) {
      t.input += u.input;
      t.output += u.output;
      t.total += u.total;
      cost += u.cost;
    }
    out.push({ providerId, tokens: t, cost });
  }
  return out.sort((a, b) => a.providerId.localeCompare(b.providerId));
}

export interface QuotaWarning {
  providerId: string;
  overTokens: boolean;
  overCost: boolean;
}

/** 逐 provider 比对月度配额；只报超限项。 */
export function quotaWarnings(totals: ProviderTotal[], quota: Record<string, ProviderQuota>): QuotaWarning[] {
  const out: QuotaWarning[] = [];
  for (const t of totals) {
    const q = quota[t.providerId];
    if (!q) continue;
    const overTokens = q.monthlyTokenBudget != null && t.tokens.total >= q.monthlyTokenBudget;
    const overCost = q.monthlyCostBudget != null && t.cost >= q.monthlyCostBudget;
    if (overTokens || overCost) out.push({ providerId: t.providerId, overTokens, overCost });
  }
  return out;
}
