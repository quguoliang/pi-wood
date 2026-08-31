import CodeMirror from "@uiw/react-codemirror";
import { unifiedMergeView } from "@codemirror/merge";
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
    return <div className="workbench-empty"><Icon name="file" /><p>Agent 修改文件后，变更会在这里集中审阅。</p></div>;
  }

  return (
    <div className="diff-panel">
      {diffs.map((diff) => (
        <div key={diff.id ?? `${diff.file}:${diff.after?.length ?? 0}`} className="diff-box">
          <div className="diff-file">
            <span>{diff.file}</span>
            {diff.id && <button type="button" onClick={() => void revert(diff.id!)}>还原此变更</button>}
          </div>
          {diff.before !== undefined && diff.after !== undefined ? (
            <CodeMirror
              value={diff.after}
              theme="dark"
              editable={false}
              height="100%"
              extensions={[unifiedMergeView({ original: diff.before })]}
            />
          ) : <pre>{diff.patch}</pre>}
        </div>
      ))}
    </div>
  );
}
