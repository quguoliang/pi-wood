import { useEffect, useRef, useState } from "react";
import { FilesPanel } from "./FilesPanel";
import { TerminalPanel } from "./TerminalPanel";
import { BrowserPanel } from "./BrowserPanel";

/** T2.x 右栏工作台：文件 / 终端 / 浏览器 / Diff 四标签（dockview 布局管理在 T2.5 评估） */
type Tab = "files" | "term" | "browser" | "diff";

export function RightPane({ diffs }: { diffs: Array<{ file: string; patch: string }> }) {
  const [tab, setTab] = useState<Tab>("files");
  const [seenCount, setSeenCount] = useState(0);
  const pending = diffs.length - seenCount;
  const seenRef = useRef(false);

  useEffect(() => {
    // 切到 Diff 页即视为已读
    if (tab === "diff") setSeenCount(diffs.length);
  }, [tab, diffs.length]);

  const diffBadge = pending > 0 ? ` (${pending} 新)` : diffs.length > 0 ? ` (${diffs.length})` : "";
  void seenRef;

  return (
    <div className="right-pane">
      <div className="right-tabs">
        <button className={tab === "files" ? "active" : ""} onClick={() => setTab("files")}>文件</button>
        <button className={tab === "term" ? "active" : ""} onClick={() => setTab("term")}>终端</button>
        <button className={tab === "browser" ? "active" : ""} onClick={() => setTab("browser")}>浏览器</button>
        <button className={tab === "diff" ? "active" : ""} onClick={() => setTab("diff")}>
          Diff{diffBadge}
        </button>
      </div>
      <div className="right-body">
        {tab === "files" && <FilesPanel />}
        {tab === "term" && <TerminalPanel />}
        {tab === "browser" && <BrowserPanel />}
        {tab === "diff" && (
          <div>
            {diffs.length === 0 && (
              <p className="muted">agent 修改文件后，变更会以 patch 形式显示在这里</p>
            )}
            {diffs.map((d) => (
              <div key={d.file + String(d.patch.length)} className="diff-box">
                <div className="diff-file">{d.file}</div>
                <pre>{d.patch}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
