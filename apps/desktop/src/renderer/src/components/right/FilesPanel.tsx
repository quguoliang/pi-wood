import { useCallback, useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSessionStore } from "../../stores/session-store";
import { useWorkbenchStore } from "../../stores/workbench-store";

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
  const engineReady = useSessionStore((s) => s.engineReady);
  const requestedFile = useWorkbenchStore((s) => s.requestedFile);
  const clearRequestedFile = useWorkbenchStore((s) => s.clearRequestedFile);
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
    // fs:tree 依赖主进程引擎已启动——以 engineReady 为准（activeProject 在引擎启动失败时仍保留）
    if (!engineReady) {
      setExpanded(new Map());
      return;
    }
    void loadChildren(undefined).then((entries) => {
      setExpanded((m) => new Map(m).set("", entries));
    }).catch((err) => setStatus(String(err?.message ?? err)));
  }, [engineReady, loadChildren]);

  const toggleDir = (entry: FileEntry): void => {
    setExpanded((m) => {
      const next = new Map(m);
      if (next.has(entry.path)) next.delete(entry.path);
      else void loadChildren(entry.path).then((entries) => setExpanded((m2) => new Map(m2).set(entry.path, entries)));
      return next;
    });
  };

  const openFile = useCallback((entry: FileEntry): void => {
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
  }, []);

  useEffect(() => {
    if (!requestedFile) return;
    openFile({ path: requestedFile, name: requestedFile.split(/[\\/]/).pop() ?? requestedFile, type: "file" });
    clearRequestedFile();
  }, [clearRequestedFile, openFile, requestedFile]);

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
          className="flex cursor-pointer select-none items-center gap-1 rounded px-1 py-0.5 font-mono text-xs text-foreground hover:bg-accent"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => (entry.type === "dir" ? toggleDir(entry) : openFile(entry))}
        >
          <span className="w-3 shrink-0 text-muted-foreground">{entry.type === "dir" ? (expanded.has(entry.path) ? "▾" : "▸") : ""}</span>
          <span className="truncate">{entry.name}</span>
        </div>
        {entry.type === "dir" && expanded.has(entry.path) && (
          <>{renderEntries(expanded.get(entry.path) ?? [], depth + 1)}</>
        )}
      </div>
    ));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!engineReady ? (
        <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
          <p>{activeProject ? "引擎未就绪：启动失败，请在设置中检查模型与 API Key 后重选项目。" : "选择一个项目后即可浏览和编辑文件。"}</p>
        </div>
      ) : (
        <>
          <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
            <Input
              className="h-8"
              value={search}
              placeholder="文件名搜索…"
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
            />
            {searchResults && (
              <Button variant="ghost" size="sm" onClick={() => { setSearchResults(null); setSearch(""); }}>清除</Button>
            )}
          </div>
          {searchResults ? (
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card/40 p-1">
              {searchResults.length === 0 && <p className="p-2 text-xs text-muted-foreground">无匹配</p>}
              {searchResults.map((r) => (
                <div
                  key={r.path}
                  className="flex cursor-pointer select-none items-center gap-1 rounded px-1 py-0.5 font-mono text-xs text-foreground hover:bg-accent"
                  onClick={() => openFile({ ...r, name: r.path, type: "file" })}
                >
                  <span className="truncate">{r.path}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card/40 p-1">{renderEntries(expanded.get("") ?? [], 0)}</div>
          )}

          {active && (
            <div className="shrink-0 overflow-hidden rounded-lg border border-border bg-card/40">
              <div className="flex h-9 items-center gap-1.5 border-b border-border px-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{active.path}{active.dirty ? " *" : ""}</span>
                <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
                  {editing ? "切只读" : "切编辑"}
                </Button>
                {editing && (
                  <Button variant="ghost" size="sm" onClick={saveActive} disabled={!active.dirty}>
                    保存
                  </Button>
                )}
                {status && <span className="text-xs text-muted-foreground">{status}</span>}
              </div>
              <div className="cm-host overflow-hidden">
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
            </div>
          )}
        </>
      )}
    </div>
  );
}

export type { OpenFile };
