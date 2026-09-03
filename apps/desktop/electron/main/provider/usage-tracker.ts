import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addDelta,
  monthKey,
  parseStore,
  providerTotals,
  quotaWarnings,
  serializeStore,
  toEntries,
  type ProviderQuota,
  type QuotaWarning,
  type UsageEntry,
} from "./usage-core.ts";

/**
 * T7.12 用量追踪器：把「会话累计 token/cost 快照」求差、按当前 provider/model 归属，累加到
 * 月度文件 `~/.pi-wood/usage/<YYYY-MM>.json`（跨月自动新文件＝重置）。
 * 由 engine-manager 在每轮 agent_settled 调 `recordUsage`；设置页经 IPC 读 `readUsage`。
 */

interface Snapshot {
  input: number;
  output: number;
  total: number;
  cost: number;
}

export interface UsageSnapshot {
  entries: UsageEntry[];
  month: string;
}

export interface UsageView {
  month: string;
  entries: UsageEntry[];
  totals: ReturnType<typeof providerTotals>;
  warnings: QuotaWarning[];
  quota: Record<string, ProviderQuota>;
}

export interface UsageTrackerDeps {
  appDataDir: string;
  now(): number;
  getQuota(): Record<string, ProviderQuota>;
}

export class UsageTracker {
  private baselines = new Map<string, Snapshot>();
  private deps: UsageTrackerDeps;

  constructor(deps: UsageTrackerDeps) {
    this.deps = deps;
  }

  private file(month: string): string {
    return join(this.deps.appDataDir, "usage", `${month}.json`);
  }
  private load(month: string) {
    const p = this.file(month);
    return parseStore(existsSync(p) ? this.read(p) : "");
  }
  private read(p: string): string {
    try {
      return readFileSync(p, "utf-8");
    } catch {
      return "";
    }
  }

  currentMonth(): string {
    return monthKey(this.deps.now());
  }

  /**
   * 记录一次会话累计快照，落 (providerId, modelId) 的本月增量。
   * @param sessionId 会话 id（按它维护上一次快照求差）；无 id 时以 provider|model 为键兜底。
   */
  recordUsage(sessionId: string, providerId: string, modelId: string, stats: Partial<Snapshot> | undefined): void {
    if (!providerId || !modelId || !stats) return;
    const key = sessionId || `${providerId}|${modelId}`;
    const cur: Snapshot = {
      input: Math.max(0, stats.input ?? 0),
      output: Math.max(0, stats.output ?? 0),
      total: Math.max(0, stats.total ?? (stats.input ?? 0) + (stats.output ?? 0)),
      cost: Math.max(0, stats.cost ?? 0),
    };
    const prev = this.baselines.get(key) ?? { input: 0, output: 0, total: 0, cost: 0 };
    this.baselines.set(key, cur);
    const dInput = Math.max(0, cur.input - prev.input);
    const dOutput = Math.max(0, cur.output - prev.output);
    const dTotal = Math.max(0, cur.total - prev.total);
    const dCost = Math.max(0, cur.cost - prev.cost);
    if (dInput === 0 && dOutput === 0 && dTotal === 0 && dCost === 0) return;

    const month = this.currentMonth();
    const next = addDelta(this.load(month), providerId, modelId, {
      input: dInput,
      output: dOutput,
      total: dTotal,
      cost: dCost,
    });
    this.write(month, next);
  }

  private write(month: string, store: ReturnType<typeof parseStore>): void {
    const p = this.file(month);
    mkdirSync(join(this.deps.appDataDir, "usage"), { recursive: true });
    try {
      writeFileSync(p, serializeStore(store), "utf-8");
    } catch {
      /* 落盘失败静默（用量非关键路径） */
    }
  }

  /** 读某月（缺省当前月）的用量视图：条目 + provider 汇总 + 配额告警。 */
  readUsage(month?: string): UsageView {
    const m = month || this.currentMonth();
    const store = this.load(m);
    const totals = providerTotals(store);
    const quota = this.deps.getQuota();
    return {
      month: m,
      entries: toEntries(store),
      totals,
      warnings: quotaWarnings(totals, quota),
      quota,
    };
  }

  /** 会话切换/新建后清掉旧会话基线（避免无界增长；非必须，仅回收）。 */
  forgetSession(sessionId: string): void {
    this.baselines.delete(sessionId);
  }
}

let tracker: UsageTracker | undefined;

export function configureUsageTracker(deps: ConstructorParameters<typeof UsageTracker>[0]): UsageTracker {
  tracker = new UsageTracker(deps);
  return tracker;
}

export function getUsageTracker(): UsageTracker | undefined {
  return tracker;
}
