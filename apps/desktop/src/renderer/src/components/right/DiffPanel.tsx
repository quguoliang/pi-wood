import { useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { unifiedMergeView } from "@codemirror/merge";
import { Button } from "@/components/ui/button";
import { Icon } from "../ui/Icon";
import { openWorkbenchFile, useWorkbenchStore } from "../../stores/workbench-store";
import type { Finding, ReviewSeverity } from "@pi-wood/ipc-schema";

const SEV_STYLE: Record<ReviewSeverity, string> = {
  error: "bg-destructive/15 text-destructive",
  warning: "bg-warning/15 text-warning",
  info: "bg-muted text-muted-foreground",
};

function SeverityBadge({ sev }: { sev: ReviewSeverity }): React.JSX.Element {
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${SEV_STYLE[sev]}`}>
      {sev === "error" ? "错误" : sev === "warning" ? "警告" : "提示"}
    </span>
  );
}

export function DiffPanel(): React.JSX.Element {
  const diffs = useWorkbenchStore((state) => state.diffs);
  const removeDiff = useWorkbenchStore((state) => state.removeDiff);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState("");
  const [reviewed, setReviewed] = useState(false);

  const revert = async (id: string): Promise<void> => {
    try {
      await window.pi.diffRevert(id);
      removeDiff(id);
    } catch {
      // 主进程通过 ui:notify 展示拒绝原因。
    }
  };

  const runReview = async (): Promise<void> => {
    setRunning(true);
    setNote("");
    setFindings([]);
    try {
      const r = await window.pi.reviewRun();
      setReviewed(true);
      setFindings(r.findings);
      if (r.error) setNote(r.error);
      else if (r.empty) setNote("工作区相对 HEAD 无改动，无需审查。");
      else if (r.findings.length === 0) setNote("已审查，未发现实质问题。");
    } catch (err) {
      setNote(`审查失败：${(err as Error)?.message ?? String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  const jump = (f: Finding): void => openWorkbenchFile(f.file, f.line && f.line > 0 ? f.line : undefined);

  // handoff：把「应用建议」拼成一句修复指令插入输入框（用户在主会话审阅后自行发送）
  const applyToComposer = (f: Finding): void => {
    const where = `${f.file}${f.line ? `:${f.line}` : ""}`;
    const text = `请修复代码审查在 ${where} 发现的问题：${f.message}${f.suggestion ? `。建议：${f.suggestion}` : ""}`;
    window.dispatchEvent(new CustomEvent("piwood:composer-insert", { detail: { text, replace: true } }));
  };

  return (
    <div className="h-full min-h-0 space-y-2 overflow-auto p-2">
      {/* T7.7 AI 审查（对活动项目 git diff HEAD 跑小模型）——独立于下方快照 diff */}
      <div className="overflow-hidden rounded-lg border border-border bg-card/40">
        <div className="flex h-9 items-center gap-2 border-b border-border px-2">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">AI 代码审查</span>
          {reviewed && !running && findings.length > 0 && <span className="text-[11px] text-muted-foreground">{findings.length} 处发现</span>}
          <Button type="button" size="sm" variant="outline" onClick={() => void runReview()} disabled={running}>
            <Icon name={running ? "spinner" : "wrench"} className={running ? "animate-spin" : undefined} />
            {running ? "审查中…" : "AI 审查变更"}
          </Button>
        </div>
        {note && <p className="px-2 py-2 text-xs text-muted-foreground">{note}</p>}
        {findings.length > 0 && (
          <ul className="max-h-72 space-y-1.5 overflow-auto p-2">
            {findings.map((f, i) => (
              <li key={`${f.file}-${f.line ?? 0}-${i}`} className="rounded border border-border/60 bg-background/40 p-2 text-xs">
                <div className="flex items-center gap-2">
                  <SeverityBadge sev={f.severity} />
                  <button type="button" className="min-w-0 flex-1 truncate text-left font-mono text-foreground underline-offset-2 hover:underline" onClick={() => jump(f)} title={f.file}>
                    {f.file}
                    {f.line ? `:${f.line}` : ""}
                  </button>
                  {f.line ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => jump(f)} title="在文件面板定位到该行">
                      定位
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" variant="ghost" onClick={() => applyToComposer(f)} title="把修复指令填入输入框">
                    应用建议
                  </Button>
                </div>
                <div className="mt-1 text-foreground">{f.message}</div>
                {f.suggestion && <div className="mt-0.5 text-muted-foreground">建议：{f.suggestion}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 原有：Agent 修改文件产生的逐条快照 diff */}
      {diffs.length === 0 ? (
        <p className="px-1 pt-2 text-center text-xs text-muted-foreground">Agent 修改文件后，逐条 diff 会在这里集中审阅。</p>
      ) : (
        diffs.map((diff) => (
          <div key={diff.id ?? `${diff.file}:${diff.after?.length ?? 0}`} className="overflow-hidden rounded-lg border border-border bg-card/40">
            <div className="flex h-9 items-center justify-between gap-1.5 border-b border-border px-2">
              <span className="min-w-0 truncate font-mono text-xs text-foreground">{diff.file}</span>
              {diff.id && (
                <Button type="button" variant="outline" size="sm" onClick={() => void revert(diff.id!)}>
                  还原此变更
                </Button>
              )}
            </div>
            {diff.before !== undefined && diff.after !== undefined ? (
              <div className="cm-host h-[280px] overflow-hidden">
                <CodeMirror value={diff.after} theme="dark" editable={false} height="100%" extensions={[unifiedMergeView({ original: diff.before })]} />
              </div>
            ) : (
              <pre className="overflow-auto p-2 font-mono text-xs text-foreground">{diff.patch}</pre>
            )}
          </div>
        ))
      )}
    </div>
  );
}
