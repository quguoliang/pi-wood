import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "../ui/Icon";
import type { UsageEntry, UsageView } from "@pi-wood/ipc-schema";
import { cn } from "@/lib/utils";

const fmtK = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)));
const usd = (n: number): string => `$${n.toFixed(n < 1 ? 4 : 2)}`;

/** 由 YYYY-MM 生成上一个/下个月键（本地整数月运算，避免 Date 时区漂移）。 */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

function ProviderCard({
  providerId,
  entries,
  totalTokens,
  totalCost,
  budget,
  warning,
  onSetBudget,
}: {
  providerId: string;
  entries: UsageEntry[];
  totalTokens: number;
  totalCost: number;
  budget?: number;
  warning: boolean;
  onSetBudget(n: number | undefined): void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const pct = budget && budget > 0 ? Math.min(100, Math.round((totalTokens / budget) * 100)) : null;
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium">{providerId}</span>
        {warning && <Badge variant="destructive" className="text-[10px]">超配额</Badge>}
        <span className="text-xs tabular-nums text-muted-foreground">{fmtK(totalTokens)} tokens · {usd(totalCost)}</span>
      </div>
      {pct != null && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full", warning ? "bg-destructive" : "bg-primary/70")} style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>月度 token 预算</span>
        <Input
          type="number"
          className="h-6 w-24 text-[11px]"
          value={budget ?? ""}
          placeholder="未设"
          onChange={(e) => onSetBudget(e.target.value ? Number(e.target.value) : undefined)}
        />
        {entries.length > 1 && (
          <button type="button" className="ml-auto inline-flex items-center gap-1 hover:text-foreground" onClick={() => setOpen((v) => !v)}>
            {entries.length} 个模型 <Icon name={open ? "chevronDown" : "chevronRight"} className="size-3" />
          </button>
        )}
      </div>
      {open && (
        <ul className="mt-1.5 space-y-0.5 border-t border-border/50 pt-1.5 text-[11px]">
          {entries.map((e) => (
            <li key={e.modelId} className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{e.modelId}</span>
              <span className="tabular-nums">{fmtK(e.tokens.total)} tokens</span>
              <span className="tabular-nums text-muted-foreground">{usd(e.cost)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * T7.12 用量/配额页：按 provider 汇总本月 tokens/cost + 模型维度展开 + 月度 token 预算进度与超限告警 + 月份切换。
 */
export function UsageSettingsPanel(): React.JSX.Element {
  const [view, setView] = useState<UsageView | null>(null);
  const [month, setMonth] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const fetchMonth = useCallback((m?: string) => {
    setLoading(true);
    void window.pi.getUsage(m || undefined).then((v) => {
      setView(v);
      if (v && !m) setMonth(v.month);
      setLoading(false);
    });
  }, []);
  useEffect(() => {
    fetchMonth();
  }, [fetchMonth]);

  const setBudget = (providerId: string, n: number | undefined): void => {
    void window.pi.settingsSet({ quota: { [providerId]: { monthlyTokenBudget: n ?? 0 } } }).then(() => fetchMonth(month));
  };

  if (loading && !view) return <p className="text-xs text-muted-foreground">加载用量…</p>;
  if (!view) return <p className="text-xs text-muted-foreground">用量服务未就绪。</p>;

  const totalMap = new Map(view.totals.map((t) => [t.providerId, t]));
  const warnSet = new Set(view.warnings.map((w) => w.providerId));
  const byProvider = new Map<string, UsageEntry[]>();
  for (const e of view.entries) {
    const arr = byProvider.get(e.providerId) ?? [];
    arr.push(e);
    byProvider.set(e.providerId, arr);
  }
  const providers = [...byProvider.keys()];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs text-muted-foreground">按 provider 汇总本月 token 与费用；超限只告警不阻断。</p>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" onClick={() => { const m = shiftMonth(month, -1); setMonth(m); fetchMonth(m); }} aria-label="上一月">
            <Icon name="chevronRight" className="size-4 rotate-180" />
          </Button>
          <span className="w-20 text-center text-xs tabular-nums">{month}</span>
          <Button size="icon-sm" variant="ghost" onClick={() => { const m = shiftMonth(month, 1); setMonth(m); fetchMonth(m); }} aria-label="下一月">
            <Icon name="chevronRight" className="size-4" />
          </Button>
        </div>
      </div>
      {providers.length === 0 ? (
        <p className="text-xs text-muted-foreground">本月还没有用量记录（跑一轮对话后出现）。</p>
      ) : (
        <div className="space-y-2">
          {providers.map((pid) => {
            const entries = byProvider.get(pid) ?? [];
            const t = totalMap.get(pid);
            return (
              <ProviderCard
                key={pid}
                providerId={pid}
                entries={entries}
                totalTokens={t?.tokens.total ?? 0}
                totalCost={t?.cost ?? 0}
                budget={view.quota[pid]?.monthlyTokenBudget || undefined}
                warning={warnSet.has(pid)}
                onSetBudget={(n) => setBudget(pid, n)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
