import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSessionStore } from "../../stores/session-store";
import { useRuntimeStore } from "../../stores/runtime-store";
import { Icon, type IconName } from "../ui/Icon";
import { cn } from "@/lib/utils";

function summarizeInput(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  for (const key of ["command", "path", "file", "pattern", "query", "url"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      const flat = value.replace(/\s+/g, " ").trim();
      return flat.length > 40 ? `${flat.slice(0, 39)}…` : flat;
    }
  }
  return "";
}

function Group({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="border-b border-border/70 px-3 py-2.5 last:border-b-0">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</span>
        {action}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ icon, title, spin, children }: { icon: IconName; title?: string; spin?: boolean; children: React.ReactNode }) {
  return (
    <div title={title} className="flex items-start gap-2 text-[12.5px] text-foreground">
      <Icon name={icon} className={cn("mt-0.5 size-3.5 shrink-0 text-muted-foreground", spin && "animate-spin")} />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

const fmtK = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

export function EnvironmentPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): React.JSX.Element {
  const activeProject = useSessionStore((s) => s.activeProject);
  const streaming = useSessionStore((s) => s.streaming);
  const queue = useSessionStore((s) => s.queue);
  const info = useRuntimeStore((s) => s.info);
  const tasks = useRuntimeStore((s) => s.tasks);
  const refresh = useRuntimeStore((s) => s.refresh);
  const [showTools, setShowTools] = useState(false);
  const projectName = activeProject?.split(/[\\/]/).filter(Boolean).pop() ?? "未选择项目";

  useEffect(() => {
    if (!open || !activeProject) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [open, activeProject, refresh]);

  if (!open) return <></>;

  const git = info?.git;
  const stats = info?.stats;
  const usage = info?.contextUsage;
  const showTasks = streaming || tasks.length > 0;
  const queued = queue.steering.length + queue.followUp.length;

  return (
    <aside aria-label="运行时信息" className="absolute right-3 top-12 z-30 w-[19rem]">
      <div className="overflow-hidden rounded-xl border border-border bg-popover/95 shadow-xl backdrop-blur">
        <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="text-[13px] font-medium text-foreground">运行时信息</span>
          <Button variant="ghost" size="icon-sm" className="size-6 text-muted-foreground hover:text-foreground" onClick={() => onOpenChange(false)} aria-label="收起运行时信息">
            <Icon name="x" size={14} />
          </Button>
        </header>

        {!activeProject ? (
          <div className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">选择项目后展示运行时信息</div>
        ) : (
          <>
            <Group title="会话">
              <Row icon="folder" title={activeProject}>{projectName}</Row>
              {info?.model && <Row icon="cpu">{info.model}</Row>}
              {info?.thinkingLevel && <Row icon="brain">思考 · {info.thinkingLevel}</Row>}
              {usage && (
                <div className="pt-0.5">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>上下文</span>
                    <span>{usage.tokens == null ? "待统计" : `${fmtK(usage.tokens)}/${fmtK(usage.contextWindow)}`}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.min(100, usage.percent ?? 0)}%` }} />
                  </div>
                </div>
              )}
            </Group>

            {git && (git.changed > 0 || git.branch) && (
              <Group title="变更">
                {git.branch && <Row icon="gitBranch">{git.branch}</Row>}
                {git.changed > 0 && (
                  <Row icon="file">
                    {git.changed} 个文件 · <span className="text-success">+{git.added}</span> <span className="text-destructive">−{git.deleted}</span>
                  </Row>
                )}
                {git.files.length > 0 && (
                  <div className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
                    {git.files.map((f) => (
                      <div key={f.path} className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                        <span className={cn("w-3 shrink-0 text-center", f.status.startsWith("A") ? "text-success" : f.status.startsWith("D") ? "text-destructive" : "text-warning")}>{f.status[0] ?? "M"}</span>
                        <span className="truncate">{f.path}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Group>
            )}

            {info?.tools && info.tools.length > 0 && (
              <Group
                title="工具"
                action={
                  <button type="button" onClick={() => setShowTools((v) => !v)} className="text-[11px] text-muted-foreground hover:text-foreground">
                    {info.tools.length} 个{showTools ? " ▴" : " ▾"}
                  </button>
                }
              >
                {showTools ? (
                  <div className="flex flex-wrap gap-1">
                    {info.tools.map((t) => (
                      <span key={t} className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">{t}</span>
                    ))}
                  </div>
                ) : (
                  <Row icon="wrench" title={info.tools.join(", ")}>{info.tools.slice(0, 6).join("、")}{info.tools.length > 6 ? " …" : ""}</Row>
                )}
              </Group>
            )}

            {showTasks && (
              <Group title="运行中">
                {tasks.length === 0 && streaming && <Row icon="spinner" spin>Pi 正在思考…</Row>}
                {tasks.map((t) => (
                  <Row key={t.toolCallId} icon="spinner" spin title={t.toolName}>
                    {t.toolName}{summarizeInput(t.input) && ` · ${summarizeInput(t.input)}`}
                  </Row>
                ))}
                {queued > 0 && <Row icon="command">{`排队 ${queue.steering.length} 引导 · ${queue.followUp.length} 追问`}</Row>}
              </Group>
            )}

            {stats && (
              <Group title="统计">
                <Row icon="context">{stats.userMessages + stats.assistantMessages} 条消息 · {stats.toolCalls} 次工具调用</Row>
                <Row icon="command">{stats.tokens.total.toLocaleString()} tokens{stats.cost > 0 && ` · $${stats.cost.toFixed(4)}`}</Row>
              </Group>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
