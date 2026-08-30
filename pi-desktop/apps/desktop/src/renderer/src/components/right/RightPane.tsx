import { useState } from "react";
import { FilesPanel } from "./FilesPanel";

/** T2.1 右栏工作台：Files / Diff 标签（dockview 停靠布局在 T2.5 接管） */
export function RightPane({ diffs }: { diffs: Array<{ file: string; patch: string }> }) {
  const [tab, setTab] = useState<"files" | "diff">("files");

  return (
    <div className="right-pane">
      <div className="right-tabs">
        <button className={tab === "files" ? "active" : ""} onClick={() => setTab("files")}>文件</button>
        <button className={tab === "diff" ? "active" : ""} onClick={() => setTab("diff")}>
          Diff{diffs.length > 0 ? ` (${diffs.length})` : ""}
        </button>
      </div>
      {tab === "files" ? (
        <FilesPanel />
      ) : (
        <div>
          {diffs.length === 0 && <p className="muted">文件变更实时显示（T2.2 正式化为 snapshot-service + MergeView）</p>}
          {diffs.map((d) => (
            <div key={d.file} className="diff-box">
              <div className="diff-file">{d.file}</div>
              <pre>{d.patch}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
