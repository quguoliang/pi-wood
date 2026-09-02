import { useEffect } from "react";
import { Icon } from "../ui/Icon";
import { cn } from "@/lib/utils";
import { useSubagentStore } from "../../stores/subagent-store";
import type { SubagentRunInfo } from "@pi-wood/ipc-schema";

/** 毫秒 → 人读耗时（<1s 显示 ms，<60s 显示 s，否则 m s）。 */
function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${Math.round(s % 60)}s`;
}

const STATUS_META: Record<SubagentRunInfo["status"], { label: string; cls: string; dot: string }> = {
  running: { label: "运行中", cls: "text-primary bg-primary/10 border-primary/20", dot: "bg-primary animate-pulse" },
  completed: { label: "已完成", cls: "text-success bg-success/10 border-success/20", dot: "bg-success" },
  failed: { label: "失败", cls: "text-destructive bg-destructive/10 border-destructive/20", dot: "bg-destructive" },
  cancelled: { label: "已取消", cls: "text-muted-foreground bg-muted border-border", dot: "bg-muted-foreground/50" },
};

function RunRow({ run }: { run: SubagentRunInfo }): React.JSX.Element {
  const meta = STATUS_META[run.status];
  return (
    <div className="rounded-lg border border-border/60 bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{run.agent}</span>
        <span className={cn("shrink-0 rounded border px-1.5 py-0.5 text-[10px]", meta.cls)}>{meta.label}</span>
      </div>
      {run.description && (
        <p className="mt-1.5 truncate text-xs text-muted-foreground" title={run.description}>
          {run.description}
        </p>
      )}
      {run.activity && (
        <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground/80" title={run.activity}>
          {run.activity}
        </p>
      )}
      <div className="mt-1.5 flex items-center gap-3 font-mono text-[10px] text-muted-foreground/70">
        <span>耗时 {formatElapsed(run.elapsedMs)}</span>
        <span>{run.turns} 轮</span>
        <span className="truncate opacity-60">{run.id.slice(0, 8)}</span>
      </div>
    </div>
  );
}

/**
 * T6.3 子代理状态面板：实时列出当前项目运行过/进行中的子代理 run（数据源 = 主进程订阅
 * vendored runs 注册表后推送的快照）。解决"看不到子代理在干嘛"——只读观察，不干预。
 */
export function SubagentPanel(): React.JSX.Element {
  const runs = useSubagentStore((s) => s.runs);
  const refresh = useSubagentStore((s) => s.refresh);

  // 挂载时拉一次初值（增量走 App 的全局 onSubagentRuns 订阅→store）。
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 运行中的排前面，其余按最近（id 稳定即可，列表小）。
  const ordered = [...runs].sort((a, b) => {
    const ar = a.status === "running" ? 0 : 1;
    const br = b.status === "running" ? 0 : 1;
    return ar - br;
  });
  const runningCount = runs.filter((r) => r.status === "running").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3">
        <Icon name="brain" className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          子代理{runs.length > 0 ? ` · ${runs.length}` : ""}
        </span>
        {runningCount > 0 && (
          <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{runningCount} 运行中</span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2.5">
        {ordered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
            <Icon name="brain" className="size-6 opacity-50" />
            <p>暂无子代理运行</p>
            <p className="text-muted-foreground/70">
              让主 agent 用 <code className="rounded bg-muted px-1 py-0.5 font-mono">agent_start</code> 委派任务后，这里会实时显示每个子代理的状态、耗时与轮次。
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {ordered.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
