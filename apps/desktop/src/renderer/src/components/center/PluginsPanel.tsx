import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usePluginStore } from "../../stores/plugin-store";
import { cn } from "@/lib/utils";
import type { PluginActivity, PluginLifecycleStatus } from "@pi-wood/ipc-schema";
import { Bug, RefreshCw, RotateCw, ShieldAlert } from "lucide-react";

const STATUS: Record<PluginLifecycleStatus, { label: string; variant: "success" | "warning" | "destructive" | "secondary" | "outline" }> = {
  running: { label: "运行中", variant: "success" },
  starting: { label: "启动中", variant: "warning" },
  restarting: { label: "重启中", variant: "warning" },
  crashed: { label: "已崩溃", variant: "destructive" },
  stopped: { label: "已停止", variant: "secondary" },
  disabled: { label: "已禁用", variant: "outline" },
};

const ACTIVITY_DOT: Record<PluginActivity["kind"], string> = {
  call: "bg-primary/50",
  denied: "bg-destructive",
  crash: "bg-destructive",
  restart: "bg-warning",
  confirm: "bg-success",
  notify: "bg-primary",
  log: "bg-muted-foreground/40",
  info: "bg-muted-foreground/40",
};

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

function ActivityRow({ a }: { a: PluginActivity }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 text-xs leading-5">
      <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", ACTIVITY_DOT[a.kind])} />
      <span className="shrink-0 tabular-nums text-muted-foreground">{fmtTime(a.ts)}</span>
      <span className="min-w-0 break-all text-foreground/80">{a.text}</span>
    </div>
  );
}

export function PluginsPanel(): React.JSX.Element {
  const list = usePluginStore((s) => s.list);
  const loaded = usePluginStore((s) => s.loaded);
  const refresh = usePluginStore((s) => s.refresh);
  const setEnabled = usePluginStore((s) => s.setEnabled);
  const restart = usePluginStore((s) => s.restart);
  const reload = usePluginStore((s) => s.reload);
  const demo = usePluginStore((s) => s.demo);

  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <p className="text-xs text-muted-foreground">
          桌面插件以独立 <span className="font-mono">utilityProcess</span> 进程沙箱运行（方案 §6）。
          插件仅能调用其 manifest 声明的权限；未声明的 API 一律拒绝并记入活动流。崩溃自动重启并通知，不伤及主进程。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void reload()}>
            <RefreshCw /> 重新发现
          </Button>
          <Button size="sm" variant="outline" onClick={() => void demo("crash")}>
            <Bug /> 演示：插件崩溃 + 自动重启
          </Button>
          <Button size="sm" variant="outline" onClick={() => void demo("overreach")}>
            <ShieldAlert /> 演示：越权调用被拒
          </Button>
        </div>
      </section>

      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          未发现插件。内置示例位于 <span className="font-mono">plugins-examples/</span>，用户级插件位于 <span className="font-mono">~/.pi-wood/plugins/</span>。
        </p>
      ) : (
        <div className="space-y-3">
          {list.map((p) => {
            const st = STATUS[p.status] ?? STATUS.stopped;
            return (
              <div key={p.id} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{p.displayName}</span>
                      <Badge variant="outline" className="shrink-0 text-[10px]">{p.source === "bundled" ? "内置" : "用户"}</Badge>
                      <span className="shrink-0 text-xs text-muted-foreground">v{p.version}</span>
                    </div>
                    {p.description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{p.description}</p>}
                  </div>
                  <Badge variant={st.variant} className="shrink-0">{st.label}</Badge>
                  <Switch checked={p.enabled} onCheckedChange={(v) => void setEnabled(p.id, v)} aria-label={`启用 ${p.displayName}`} />
                  <Button size="icon-sm" variant="ghost" title="重启" onClick={() => void restart(p.id)}>
                    <RotateCw />
                  </Button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <span className="text-[11px] text-muted-foreground">权限：</span>
                  {p.permissions.length === 0 ? (
                    <span className="text-[11px] text-muted-foreground">（无）</span>
                  ) : (
                    p.permissions.map((perm) => (
                      <span key={perm} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{perm}</span>
                    ))
                  )}
                  {p.restarts > 0 && <span className="ml-auto text-[11px] text-warning">本会话重启 {p.restarts} 次</span>}
                  {p.pid && <span className={cn("text-[11px] text-muted-foreground", p.restarts === 0 && "ml-auto")}>pid {p.pid}</span>}
                </div>

                {p.activity.length > 0 && (
                  <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded-md bg-background/40 p-2">
                    {[...p.activity].reverse().slice(0, 12).map((a, i) => (
                      <ActivityRow key={`${a.ts}-${i}`} a={a} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
