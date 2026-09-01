import CodeMirror from "@uiw/react-codemirror";
import { unifiedMergeView } from "@codemirror/merge";
import { Button } from "@/components/ui/button";
import { Icon } from "../ui/Icon";
import { useWorkbenchStore } from "../../stores/workbench-store";

export function DiffPanel(): React.JSX.Element {
  const diffs = useWorkbenchStore((state) => state.diffs);
  const removeDiff = useWorkbenchStore((state) => state.removeDiff);

  const revert = async (id: string): Promise<void> => {
    try {
      await window.pi.diffRevert(id);
      removeDiff(id);
    } catch {
      // 主进程通过 ui:notify 展示拒绝原因。
    }
  };

  if (diffs.length === 0) {
    return <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground"><Icon name="file" /><p>Agent 修改文件后，变更会在这里集中审阅。</p></div>;
  }

  return (
    <div className="h-full min-h-0 space-y-2 overflow-auto p-2">
      {diffs.map((diff) => (
        <div key={diff.id ?? `${diff.file}:${diff.after?.length ?? 0}`} className="overflow-hidden rounded-lg border border-border bg-card/40">
          <div className="flex h-9 items-center justify-between gap-1.5 border-b border-border px-2">
            <span className="min-w-0 truncate font-mono text-xs text-foreground">{diff.file}</span>
            {diff.id && <Button type="button" variant="outline" size="sm" onClick={() => void revert(diff.id!)}>还原此变更</Button>}
          </div>
          {diff.before !== undefined && diff.after !== undefined ? (
            <div className="cm-host h-[280px] overflow-hidden">
              <CodeMirror
                value={diff.after}
                theme="dark"
                editable={false}
                height="100%"
                extensions={[unifiedMergeView({ original: diff.before })]}
              />
            </div>
          ) : <pre className="overflow-auto p-2 font-mono text-xs text-foreground">{diff.patch}</pre>}
        </div>
      ))}
    </div>
  );
}
