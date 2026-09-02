import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "../ui/Icon";
import { cn } from "@/lib/utils";
import { Markdown, ThinkingCard } from "@pi-wood/ui-kit";
import { useSubagentStore, type SubagentItem } from "../../stores/subagent-store";
import type { SubagentRunInfo } from "@pi-wood/ipc-schema";

/** 毫秒 → 人读耗时。 */
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

function StatusBadge({ status }: { status: SubagentRunInfo["status"] }): React.JSX.Element {
  const meta = STATUS_META[status];
  return <span className={cn("shrink-0 rounded border px-1.5 py-0.5 text-[10px]", meta.cls)}>{meta.label}</span>;
}

function RunRow({ run, onOpen }: { run: SubagentRunInfo; onOpen(): void }): React.JSX.Element {
  const meta = STATUS_META[run.status];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-lg border border-border/60 bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-white/[0.05]"
    >
      <div className="flex items-center gap-2">
        <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{run.agent}</span>
        <StatusBadge status={run.status} />
        <Icon name="chevronRight" className="size-3.5 shrink-0 text-muted-foreground" />
      </div>
      {run.description && <p className="mt-1.5 truncate text-xs text-muted-foreground">{run.description}</p>}
      {run.activity && <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground/80">{run.activity}</p>}
      <div className="mt-1.5 flex items-center gap-3 font-mono text-[10px] text-muted-foreground/70">
        <span>耗时 {formatElapsed(run.elapsedMs)}</span>
        <span>{run.turns} 轮</span>
        <span className="truncate opacity-60">{run.id.slice(0, 8)}</span>
      </div>
    </button>
  );
}

/** 只读渲染单条转录项（无 Composer、无审批按钮）。 */
function TranscriptItem({ item }: { item: SubagentItem }): React.JSX.Element | null {
  if (item.kind === "user") {
    return (
      <div className="rounded-md bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/70">任务：</span>
        {item.text}
      </div>
    );
  }
  if (item.kind === "thinking") {
    return <ThinkingCard text={item.text ?? ""} streaming={false} defaultOpen={false} />;
  }
  if (item.kind === "tool") {
    const tone = item.status === "error" ? "text-destructive" : item.status === "ok" ? "text-success" : "text-primary";
    return (
      <div className="rounded-md border border-border/50 bg-white/[0.02] px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 text-xs">
          <Icon name="wrench" className={cn("size-3.5", tone)} />
          <span className="font-mono text-foreground">{item.name}</span>
          {item.status === "running" && <span className="animate-pulse text-[10px] text-primary">运行中</span>}
        </div>
        {item.output && (
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
            {item.output}
          </pre>
        )}
      </div>
    );
  }
  if (item.kind === "assistant") {
    return (
      <div className="pk-prose max-w-none text-[13px]">
        <Markdown>{item.text ?? ""}</Markdown>
      </div>
    );
  }
  return null;
}

function DetailView({ run, onBack }: { run: SubagentRunInfo; onBack(): void }): React.JSX.Element {
  const items = useSubagentStore((s) => s.itemsByRun[run.id] ?? []);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-muted-foreground hover:text-foreground" onClick={onBack}>
          <Icon name="chevronRight" className="size-3.5 rotate-180" />
          返回
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{run.agent}</span>
        <StatusBadge status={run.status} />
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-auto px-3 py-3">
        {items.length === 0 ? (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            该子代理暂无可展示的流式内容（可能已在本面板接入前完成，或只读事件未捕获到）。
          </p>
        ) : (
          items.map((item) => <TranscriptItem key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}

/**
 * T6.3/T6.5 子代理面板：列表实时展示每个子代理 run 的状态；点击某行进入只读详情，
 * 流式显示该子代理的完整执行转录本（任务/思考/工具/回复），不可干预。
 */
export function SubagentPanel(): React.JSX.Element {
  const runs = useSubagentStore((s) => s.runs);
  const refresh = useSubagentStore((s) => s.refresh);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = selectedId ? runs.find((r) => r.id === selectedId) : undefined;
  if (selected) return <DetailView run={selected} onBack={() => setSelectedId(null)} />;

  const ordered = [...runs].sort((a, b) => (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1));
  const runningCount = runs.filter((r) => r.status === "running").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3">
        <Icon name="brain" className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">子代理{runs.length > 0 ? ` · ${runs.length}` : ""}</span>
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
              让主 agent 用 <code className="rounded bg-muted px-1 py-0.5 font-mono">agent_start</code> 委派任务后，这里会实时显示状态；点击可查看其完整执行过程。
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {ordered.map((run) => (
              <RunRow key={run.id} run={run} onOpen={() => setSelectedId(run.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
