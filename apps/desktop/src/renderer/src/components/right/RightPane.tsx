import { useEffect, useState } from "react";
import { FilesPanel } from "./FilesPanel";
import { TerminalPanel } from "./TerminalPanel";
import { BrowserPanel } from "./BrowserPanel";
import CodeMirror from "@uiw/react-codemirror";
import { unifiedMergeView } from "@codemirror/merge";
import { Icon, type IconName } from "../ui/Icon";

/** T2.x 右栏工作台：文件 / 终端 / 浏览器 / Diff 四标签（dockview 布局管理在 T2.5 评估） */
type Tab = "files" | "term" | "browser" | "diff";

const tabMeta: Record<Tab, { label: string; icon: IconName }> = {
  files: { label: "文件", icon: "folder" },
  term: { label: "终端", icon: "terminal" },
  browser: { label: "浏览器", icon: "browser" },
  diff: { label: "变更", icon: "file" },
};

interface DiffItem {
  file: string;
  before?: string;
  after?: string;
  patch?: string;
}

export function RightPane({ diffs }: { diffs: DiffItem[] }) {
  const [openTabs, setOpenTabs] = useState<Tab[]>(["files"]);
  const [tab, setTab] = useState<Tab | null>("files");
  const [seenCount, setSeenCount] = useState(0);
  const pending = diffs.length - seenCount;

  useEffect(() => {
    // 切到 Diff 页即视为已读
    if (tab === "diff") setSeenCount(diffs.length);
  }, [tab, diffs.length]);

  const diffBadge = pending > 0 ? ` ${pending}` : diffs.length > 0 ? ` ${diffs.length}` : "";
  const openTab = (next: Tab): void => {
    setOpenTabs((tabs) => (tabs.includes(next) ? tabs : [...tabs, next]));
    setTab(next);
  };
  const closeTab = (closing: Tab): void => {
    setOpenTabs((tabs) => {
      const next = tabs.filter((item) => item !== closing);
      if (tab === closing) setTab(next[next.length - 1] ?? null);
      return next;
    });
  };

  useEffect(() => {
    const onOpen = (event: Event): void => openTab((event as CustomEvent<Tab>).detail);
    window.addEventListener("piwood:open-workbench", onOpen);
    return () => window.removeEventListener("piwood:open-workbench", onOpen);
  }, []);

  return (
    <div className="right-pane">
      <nav className="workbench-tabs" aria-label="工作区标签">
        {openTabs.map((key) => (
          <div key={key} className={`workbench-tab ${tab === key ? "active" : ""}`}>
            <button type="button" onClick={() => setTab(key)}><Icon name={tabMeta[key].icon} />{tabMeta[key].label}{key === "diff" ? diffBadge : ""}</button>
            <button className="workbench-tab-close" type="button" onClick={() => closeTab(key)} aria-label={`关闭${tabMeta[key].label}`}><Icon name="x" /></button>
          </div>
        ))}
        <button className="workbench-tab-add" type="button" onClick={() => openTab("files")} aria-label="打开文件"><Icon name="add" /></button>
      </nav>
      <main className="right-content">
        {tab ? (
          <section className="workbench-full" aria-label={`${tabMeta[tab].label}面板`}>
          {tab === "files" && <FilesPanel />}
          {tab === "term" && <TerminalPanel />}
          {tab === "browser" && <BrowserPanel />}
          {tab === "diff" && (
          <div>
            {diffs.length === 0 && (
              <div className="workbench-empty"><Icon name="file" /><p>Agent 修改文件后，变更会在这里集中审阅。</p></div>
            )}
            {diffs.map((d) =>
              d.before !== undefined && d.after !== undefined ? (
                <div key={d.file + String(d.after.length)} className="diff-box">
                  <div className="diff-file">{d.file}</div>
                  <CodeMirror
                    value={d.after}
                    theme="dark"
                    editable={false}
                    height="280px"
                    extensions={[unifiedMergeView({ original: d.before })]}
                  />
                </div>
              ) : (
                <div key={d.file} className="diff-box">
                  <div className="diff-file">{d.file}</div>
                  <pre>{d.patch}</pre>
                </div>
              ),
            )}
          </div>
          )}
          </section>
        ) : <div className="workbench-empty"><p>打开文件、终端、浏览器或变更面板。</p></div>}
      </main>
    </div>
  );
}
