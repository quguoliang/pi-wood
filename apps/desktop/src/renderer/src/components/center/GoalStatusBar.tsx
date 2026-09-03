import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useGoalStore } from "../../stores/goal-store";
import { useSessionStore } from "../../stores/session-store";
import { Icon } from "../ui/Icon";
import { cn } from "@/lib/utils";
import type { GoalStatus } from "@pi-wood/ipc-schema";

const LABEL: Record<GoalStatus, { text: string; variant: "success" | "warning" | "destructive" | "secondary" | "outline" }> = {
  active: { text: "自动推进中", variant: "success" },
  paused: { text: "已暂停", variant: "secondary" },
  complete: { text: "已完成", variant: "success" },
  blocked: { text: "受阻", variant: "destructive" },
  budgetLimited: { text: "预算耗尽", variant: "warning" },
  auditUnavailable: { text: "审计不可用", variant: "warning" },
};

const fmtK = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

/**
 * EnvironmentPanel 目标状态条：显示当前会话目标的进度（轮次 / token 预算）+ 审计备注 + 暂停/恢复/清除。
 * 无目标时不渲染。用户 abort 主会话本轮会把 goal 置为 paused（见 goal-runtime）。
 */
export function GoalStatusBar(): React.JSX.Element | null {
  const goal = useGoalStore((s) => s.goal);
  const load = useGoalStore((s) => s.load);
  const pause = useGoalStore((s) => s.pause);
  const resume = useGoalStore((s) => s.resume);
  const clear = useGoalStore((s) => s.clear);
  const sessionId = useSessionStore((s) => s.currentSessionId);

  useEffect(() => {
    if (sessionId) void load(sessionId);
  }, [sessionId, load]);

  if (!goal) return null;
  const st = LABEL[goal.status];
  const terminal = goal.status !== "active" && goal.status !== "paused";
  const tokenPct = goal.tokenBudget > 0 ? Math.min(100, Math.round((goal.tokensUsed / goal.tokenBudget) * 100)) : 0;

  return (
    <div className="border-b border-border/70 px-3 py-2.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">目标模式</span>
        <Badge variant={st.variant}>{st.text}</Badge>
        <span className="ml-auto flex items-center gap-1">
          {goal.status === "active" && (
            <Button size="icon-sm" variant="ghost" title="暂停" onClick={() => sessionId && void pause(sessionId)}>
              <Icon name="command" className="size-3.5" />
            </Button>
          )}
          {goal.status === "paused" && (
            <Button size="sm" variant="ghost" title="恢复" onClick={() => sessionId && void resume(sessionId)}>
              恢复
            </Button>
          )}
          {terminal && (
            <Button size="sm" variant="ghost" title="重新以此目标继续" onClick={() => sessionId && void resume(sessionId)}>
              继续
            </Button>
          )}
          <Button size="sm" variant="ghost" title="清除目标" onClick={() => sessionId && void clear(sessionId)}>
            清除
          </Button>
        </span>
      </div>
      <div className={cn("text-[12.5px] text-foreground")}>
        {goal.turnsUsed}/{goal.maxTurns} 轮 · {fmtK(goal.tokensUsed)}/{fmtK(goal.tokenBudget)} tokens（{tokenPct}%）
        {goal.costUsd > 0 && ` · $${goal.costUsd.toFixed(4)}`}
      </div>
      {goal.note && <div className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{goal.note}</div>}
    </div>
  );
}
