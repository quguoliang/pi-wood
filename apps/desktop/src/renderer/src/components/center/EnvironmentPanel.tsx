import { useEffect } from "react";
import { useSessionStore } from "../../stores/session-store";
import { useRuntimeStore } from "../../stores/runtime-store";
import { Icon } from "../ui/Icon";

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

export function EnvironmentPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): React.JSX.Element {
  const activeProject = useSessionStore((s) => s.activeProject);
  const streaming = useSessionStore((s) => s.streaming);
  const info = useRuntimeStore((s) => s.info);
  const tasks = useRuntimeStore((s) => s.tasks);
  const planText = useRuntimeStore((s) => s.planText);
  const refresh = useRuntimeStore((s) => s.refresh);
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
  const showTasks = streaming || tasks.length > 0;

  return (
    <aside className="environment-float" aria-label="运行时信息">
      <div className="environment-card">
        <header>
          <span>运行时信息</span>
          <button type="button" onClick={() => onOpenChange(false)} aria-label="收起运行时信息"><Icon name="x" /></button>
        </header>

        {activeProject && (
          <div className="environment-group">
            <small>环境</small>
            <div title={activeProject}><Icon name="folder" /><span>{projectName}</span></div>
            {info?.model && <div><Icon name="cpu" /><span>{info.model}</span></div>}
            {info?.thinkingLevel && <div><Icon name="brain" /><span>思考 · {info.thinkingLevel}</span></div>}
            {info?.tools && info.tools.length > 0 && (
              <div title={info.tools.join(", ")}><Icon name="wrench" /><span>工具 {info.tools.length} 个</span></div>
            )}
          </div>
        )}

        {git && (
          <div className="environment-group">
            <small>Git</small>
            {git.branch && <div><Icon name="gitBranch" /><span>{git.branch}</span></div>}
            {git.changed > 0 && (
              <div>
                <Icon name="file" />
                <span>
                  {git.changed} 个变更
                  {(git.added > 0 || git.deleted > 0) && (
                    <>
                      {" · "}
                      <em className="environment-git-added">+{git.added}</em>{" "}
                      <em className="environment-git-deleted">−{git.deleted}</em>
                    </>
                  )}
                </span>
              </div>
            )}
          </div>
        )}

        {showTasks && (
          <div className="environment-group">
            <small>子任务</small>
            {tasks.length === 0 && streaming && (
              <div><Icon name="spinner" className="environment-spin" /><span>Pi 正在思考…</span></div>
            )}
            {tasks.map((t) => (
              <div key={t.toolCallId} title={t.toolName}>
                <Icon name="spinner" className="environment-spin" />
                <span>{t.toolName}{summarizeInput(t.input) && ` · ${summarizeInput(t.input)}`}</span>
              </div>
            ))}
          </div>
        )}

        {planText && (
          <div className="environment-group">
            <small>计划</small>
            <div><Icon name="listChecks" /><span>{planText}</span></div>
          </div>
        )}

        {stats && (
          <div className="environment-group">
            <small>会话统计</small>
            <div>
              <Icon name="context" />
              <span>{stats.userMessages + stats.assistantMessages} 条消息 · {stats.toolCalls} 次工具调用</span>
            </div>
            <div>
              <Icon name="command" />
              <span>
                {stats.tokens.total.toLocaleString()} tokens
                {stats.cost > 0 && ` · $${stats.cost.toFixed(4)}`}
              </span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
