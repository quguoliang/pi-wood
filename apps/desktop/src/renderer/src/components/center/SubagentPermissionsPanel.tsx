import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SUBAGENT_TOOL_KEYS, type SubagentProfileInfo, type ToolPermissionAction } from "@pi-wood/ipc-schema";
import { cn } from "@/lib/utils";

type Cell = ToolPermissionAction | "inherit";
const ACTIONS: Array<{ value: Cell; label: string }> = [
  { value: "inherit", label: "继承" },
  { value: "allow", label: "允许" },
  { value: "ask", label: "询问" },
  { value: "deny", label: "拒绝" },
];

/**
 * T6.7 子代理 per-tool 权限设置页。
 * 每格 = 该 agent 对该工具的审批覆盖；「继承」= 未配置（回退父会话全局审批策略）。
 * 敏感文件写（.env/.git/.ssh）是全局底线，任何档位都不会放行。
 */
export function SubagentPermissionsPanel(): React.JSX.Element {
  const [profiles, setProfiles] = useState<SubagentProfileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    void window.pi.subagentsListProfiles().then((list) => {
      setProfiles(list);
      setLoading(false);
    });
  };
  useEffect(load, []);

  const apply = (agent: string, tool: string, action: Cell): void => {
    setBusy(true);
    void window.pi.subagentsSetPermission(agent, tool, action).then((list) => {
      setProfiles(list);
      setBusy(false);
    });
  };
  const clear = (agent: string): void => {
    setBusy(true);
    void window.pi.subagentsClearPermissions(agent).then((list) => {
      setProfiles(list);
      setBusy(false);
    });
  };

  if (loading) return <p className="text-xs text-muted-foreground">正在加载子代理 profile…</p>;
  if (profiles.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        未发现子代理 profile（<span className="font-mono">~/.pi/agent/agents/*.md</span>）。用 agent_start 前需先在此目录放置 profile。
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        为每个子代理 profile 单独设定各工具的审批档位，覆盖父会话全局审批策略；「继承」= 未单独配置。
        敏感文件写入（.env / .git / .ssh 等）恒为硬底线，任何档位都不放行。改动即时生效于下一次子代理触发。
      </p>
      <div className="space-y-3">
        {profiles.map((p) => (
          <div key={p.name} className={cn("rounded-lg border border-border/60 bg-muted/20 p-3", busy && "opacity-70")}>
            <div className="mb-2 flex items-center gap-2">
              <span className="font-mono text-sm font-medium">{p.name}</span>
              {!p.inAgentsDir && <Badge variant="outline" className="text-[10px]">仅历史配置</Badge>}
              {p.description && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{p.description}</span>}
              {Object.keys(p.permissions).length > 0 && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => clear(p.name)}>
                  清除
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
              {SUBAGENT_TOOL_KEYS.map((tool) => {
                const value: Cell = p.permissions[tool] ?? "inherit";
                return (
                  <label key={tool} className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-muted-foreground">{tool}</span>
                    <select
                      className="h-7 min-w-0 rounded-md border border-input bg-transparent px-2 text-xs"
                      value={value}
                      disabled={busy}
                      onChange={(e) => apply(p.name, tool, e.target.value as Cell)}
                    >
                      {ACTIONS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
