import { useCallback, useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { useSessionStore } from "../../stores/session-store";

interface FileEntry {
  name: string;
  path: string;
  type: "dir" | "file";
}

interface OpenFile {
  path: string;
  content: string;
  dirty: boolean;
}

function isJsLike(path: string): boolean {
  return /\.(js|mjs|cjs|ts|tsx|jsx)$/.test(path);
}

export function FilesPanel(): React.JSX.Element {
  const activeProject = useSessionStore((s) => s.activeProject);
  const [expanded, setExpanded] = useState<Map<string, FileEntry[]>>(new Map());
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ path: string }> | null>(null);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState("");

  const active = openFiles.find((f) => f.path === activeFile);
  const activeContent = active?.content ?? "";

  const loadChildren = useCallback(async (dir: string | undefined): Promise<FileEntry[]> => {
    return (await window.pi.fsTree(dir)) as FileEntry[];
  }, []);

  useEffect(() => {
    if (!activeProject) {
      setExpanded(new Map());
      return;
    }
    void loadChildren(undefined).then((entries) => {
      setExpanded((m) => new Map(m).set("", entries));
    }).catch((err) => setStatus(String(err?.message ?? err)));
  }, [activeProject, loadChildren]);

  const toggleDir = (entry: FileEntry): void => {
    setExpanded((m) => {
      const next = new Map(m);
      if (next.has(entry.path)) next.delete(entry.path);
      else void loadChildren(entry.path).then((entries) => setExpanded((m2) => new Map(m2).set(entry.path, entries)));
      return next;
    });
  };

  const openFile = (entry: FileEntry): void => {
    setOpenFiles((files) => {
      if (files.some((f) => f.path === entry.path)) {
        setActiveFile(entry.path);
        return files;
      }
      void window.pi
        .fsRead(entry.path)
        .then((r) => {
          setOpenFiles((fs) => [...fs, { path: entry.path, content: r.content, dirty: false }]);
          setActiveFile(entry.path);
          setEditing(false);
        })
        .catch((err) => setStatus(String(err?.message ?? err)));
      return files;
    });
    setActiveFile(entry.path);
  };

  const saveActive = (): void => {
    if (!active) return;
    void window.pi.fsWrite(active.path, active.content).then(() => {
      setStatus(`已保存 ${active.path}`);
      setOpenFiles((fs) => fs.map((f) => (f.path === active.path ? { ...f, dirty: false } : f)));
      setTimeout(() => setStatus(""), 2500);
    });
  };

  const runSearch = (): void => {
    if (!search.trim()) {
      setSearchResults(null);
      return;
    }
    void window.pi.fsSearch(search.trim()).then((r) => setSearchResults(r as Array<{ path: string }>));
  };

  const renderEntries = (entries: FileEntry[], depth: number): React.JSX.Element[] =>
    entries.map((entry) => (
      <div key={entry.path}>
        <div
          className="tree-row file-row"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => (entry.type === "dir" ? toggleDir(entry) : openFile(entry))}
        >
          {entry.type === "dir" ? (expanded.has(entry.path) ? "▾" : "▸") : ""}{entry.name}
        </div>
        {entry.type === "dir" && expanded.has(entry.path) && (
          <>{renderEntries(expanded.get(entry.path) ?? [], depth + 1)}</>
        )}
      </div>
    ));

  return (
    <div className="files-panel">
      {!activeProject ? (
        <div className="workbench-empty"><p>选择一个项目后即可浏览和编辑文件。</p></div>
      ) : (
        <>
      <div className="files-toolbar">
        <input
          className="files-search"
          value={search}
          placeholder="文件名搜索…"
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
        />
        {searchResults && (
          <button className="ghost-btn" onClick={() => { setSearchResults(null); setSearch(""); }}>清除</button>
        )}
      </div>
      {searchResults ? (
        <div className="file-tree">
          {searchResults.length === 0 && <p className="muted">无匹配</p>}
          {searchResults.map((r) => (
            <div key={r.path} className="tree-row file-row" onClick={() => openFile({ ...r, name: r.path, type: "file" })}>
              {r.path}
            </div>
          ))}
        </div>
      ) : (
        <div className="file-tree">{renderEntries(expanded.get("") ?? [], 0)}</div>
      )}

      {active && (
        <div className="editor-area">
          <div className="editor-toolbar">
            <span className="editor-tab active">{active.path}{active.dirty ? " *" : ""}</span>
            <button className="ghost-btn" onClick={() => setEditing((v) => !v)}>
              {editing ? "切只读" : "切编辑"}
            </button>
            {editing && (
              <button className="ghost-btn" onClick={saveActive} disabled={!active.dirty}>
                保存
              </button>
            )}
            {status && <span className="muted">{status}</span>}
          </div>
          <CodeMirror
            value={active.content}
            theme="dark"
            editable={editing}
            basicSetup={{ foldGutter: false, searchKeymap: false }}
            extensions={isJsLike(active.path) ? [javascript()] : []}
            onChange={(value: string) =>
              setOpenFiles((fs) =>
                fs.map((f) =>
                  f.path === active.path ? { ...f, content: value, dirty: f.content !== value } : f,
                ),
              )
            }
            height="300px"
          />
        </div>
      )}
        </>
      )}
    </div>
  );
}

export type { OpenFile };
