import { useCallback, useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import type { editor as monacoEditor } from "monaco-editor";
import { Tree, type NodeRendererProps } from "react-arborist";
import { monaco, monacoLanguage } from "@/lib/monaco-setup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FileIcon } from "@/lib/file-icons";
import { Icon } from "../ui/Icon";
import { useActiveConversation, useSessionStore } from "../../stores/session-store";
import { useWorkbenchStore } from "../../stores/workbench-store";
import { usePendingContextStore } from "../../stores/pending-context-store";

interface FileEntry {
  name: string;
  path: string;
  type: "dir" | "file";
}

/** 树节点 = FileEntry + 懒加载的子节点（react-arborist 嵌套 data；id 走 path） */
interface FsEntry extends FileEntry {
  children?: FsEntry[];
}

interface OpenFile {
  path: string;
  content: string;
  dirty: boolean;
}

/** VSCode 资源管理器同款行高/缩进节奏 */
const ROW_HEIGHT = 22;
const INDENT = 12;
/** 右侧文件树列宽（可在 180 ~ 面板一半之间拖拽） */
const TREE_MIN_W = 180;
const TREE_DEFAULT_W = 240;

/** VSCode 排序：目录优先，名称不区分大小写、数字按值比较 */
function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

function toFsEntries(entries: FileEntry[]): FsEntry[] {
  return sortEntries(entries).map((e) => ({ ...e }));
}

/** 把拉取到的目录 children 合并进嵌套树（按 path 定位，返回新根数组） */
function mergeChildren(root: FsEntry[], dirPath: string, children: FsEntry[]): FsEntry[] {
  if (dirPath === "") return children;
  const walk = (nodes: FsEntry[]): FsEntry[] =>
    nodes.map((n) =>
      n.path === dirPath ? { ...n, children } : n.children ? { ...n, children: walk(n.children) } : n,
    );
  return walk(root);
}

/** 面包屑：按 / 或 \ 切段，最后一段加粗 */
function Breadcrumb({ path }: { path: string }): React.JSX.Element {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden whitespace-nowrap text-xs">
      {parts.map((p, i) => (
        <span key={i} className="flex min-w-0 items-center gap-0.5">
          {i > 0 && <Icon name="chevronRight" className="size-3 shrink-0 text-muted-foreground/50" />}
          <span
            className={cn(
              "truncate",
              i === parts.length - 1 ? "shrink-0 font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {p}
          </span>
        </span>
      ))}
    </div>
  );
}

export function FilesPanel(): React.JSX.Element {
  const activeProject = useSessionStore((s) => s.activeProject);
  const engineReady = useActiveConversation((c) => c.engineReady);
  const requestedFile = useWorkbenchStore((s) => s.requestedFile);
  const clearRequestedFile = useWorkbenchStore((s) => s.clearRequestedFile);
  const [treeRoot, setTreeRoot] = useState<FsEntry[]>([]);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ path: string }> | null>(null);
  const [status, setStatus] = useState("");
  const [treeW, setTreeW] = useState(TREE_DEFAULT_W);
  const [pendingReveal, setPendingReveal] = useState<{ path: string; line: number } | null>(null);
  // react-arborist：懒加载目录集合（"" = 根）+ 树高度测量（react-window 需要像素值）
  const loadedDirs = useRef<Set<string>>(new Set());
  const treeWrapRef = useRef<HTMLDivElement>(null);
  const [treeSize, setTreeSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // Monaco 实例（行定位用）；编辑器默认可编辑；Cmd/Ctrl+S 保存经 ref 取最新闭包
  const rootRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef<() => void>(() => undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewRef = useRef<any>(null);
  // Monaco 异步挂载完成标记：选中浮标/右键菜单的 effect 靠它重跑（首开文件时实例尚未就绪）
  const [editorReady, setEditorReady] = useState(false);

  const active = openFiles.find((f) => f.path === activeFile);
  const activeContent = active?.content ?? "";

  const loadChildren = useCallback(async (dir: string | undefined): Promise<FileEntry[]> => {
    return (await window.pi.fsTree(dir)) as FileEntry[];
  }, []);

  useEffect(() => {
    // fs:tree 依赖主进程引擎已启动——以 engineReady 为准（activeProject 在引擎启动失败时仍保留）
    if (!engineReady) {
      setTreeRoot([]);
      loadedDirs.current = new Set();
      return;
    }
    void loadChildren(undefined)
      .then((entries) => {
        loadedDirs.current.add("");
        setTreeRoot(toFsEntries(entries));
      })
      .catch((err) => setStatus(String(err?.message ?? err)));
  }, [engineReady, loadChildren]);

  // 展开目录前确保 children 已拉取（onToggle 对点击与键盘展开都生效，幂等）
  const ensureChildren = useCallback(
    (dirPath: string): void => {
      if (loadedDirs.current.has(dirPath)) return;
      loadedDirs.current.add(dirPath);
      void loadChildren(dirPath || undefined)
        .then((entries) => setTreeRoot((root) => mergeChildren(root, dirPath, toFsEntries(entries))))
        .catch(() => loadedDirs.current.delete(dirPath));
    },
    [loadChildren],
  );

  // 树列尺寸跟随拖拽/面板宽度
  useEffect(() => {
    const el = treeWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTreeSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [treeW]);

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
        })
        .catch((err) => setStatus(String(err?.message ?? err)));
      return files;
    });
    setActiveFile(entry.path);
  }, []);

  useEffect(() => {
    if (!requestedFile) return;
    const { path, line } = requestedFile;
    openFile({ path, name: path.split(/[\\/]/).pop() ?? path, type: "file" });
    if (line != null) setPendingReveal({ path, line });
    clearRequestedFile();
  }, [clearRequestedFile, openFile, requestedFile]);

  // 待定位文件已加载且编辑器就绪 → 定位到行（1-based）并居中滚动，随后清除
  useEffect(() => {
    if (!pendingReveal || activeFile !== pendingReveal.path) return;
    const view: monacoEditor.IStandaloneCodeEditor | null = viewRef.current;
    const model = view?.getModel();
    if (!view || !model) return;
    const n = Math.min(Math.max(1, pendingReveal.line), model.getLineCount());
    view.revealLineInCenter(n);
    view.setPosition({ lineNumber: n, column: 1 });
    setPendingReveal(null);
  }, [pendingReveal, activeFile, activeContent]);

  const saveActive = useCallback((): void => {
    const cur = openFiles.find((f) => f.path === activeFile);
    if (!cur || !cur.dirty) return;
    void window.pi.fsWrite(cur.path, cur.content).then(() => {
      setStatus(`已保存 ${cur.path}`);
      setOpenFiles((fs) => fs.map((f) => (f.path === cur.path ? { ...f, dirty: false } : f)));
      setTimeout(() => setStatus(""), 2500);
    });
  }, [openFiles, activeFile]);
  saveRef.current = saveActive;

  /** 把编辑器当前选区投递为「添加到对话」片段（浮标/右键菜单/Cmd+Shift+L 共用） */
  const addSelectionToChat = useCallback(
    (editor: monacoEditor.ICodeEditor): void => {
      const model = editor.getModel();
      const sel = editor.getSelection();
      if (!model || !sel || sel.isEmpty() || !activeFile) return;
      const snippet = model.getValueInRange(sel);
      const ok = usePendingContextStore.getState().add({
        path: activeFile,
        name: activeFile.split(/[\\/]/).pop() ?? activeFile,
        start: sel.startLineNumber,
        end: sel.endLineNumber,
        snippet,
      });
      setStatus(ok ? `已添加到对话（${sel.startLineNumber}-${sel.endLineNumber} 行）` : "该片段已在对话上下文中");
      setTimeout(() => setStatus(""), 2500);
    },
    [activeFile],
  );

  // 选中浮标：非空选区时在选区首行上方浮现「添加到对话」；滚动/收起选区即隐藏
  const [selTag, setSelTag] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    const editor: monacoEditor.IStandaloneCodeEditor | null = viewRef.current;
    if (!editor) return;
    const sync = (): void => {
      const sel = editor.getSelection();
      if (!sel || sel.isEmpty()) {
        setSelTag(null);
        return;
      }
      const pos = editor.getScrolledVisiblePosition({ lineNumber: sel.startLineNumber, column: 1 });
      if (!pos) {
        setSelTag(null);
        return;
      }
      setSelTag({ top: Math.max(pos.top - 26, 0), left: Math.max(pos.left + 24, 24) });
    };
    const d1 = editor.onDidChangeCursorSelection(sync);
    const d2 = editor.onDidScrollChange(() => setSelTag(null));
    const d3 = editor.onDidBlurEditorText(() => setSelTag(null));
    return () => {
      d1.dispose();
      d2.dispose();
      d3.dispose();
    };
  }, [activeFile, activeContent, editorReady]);

  // 右键菜单项 + Cmd/Ctrl+Shift+L（Cursor 习惯键位），挂在 Monaco 实例上
  useEffect(() => {
    const editor: monacoEditor.IStandaloneCodeEditor | null = viewRef.current;
    if (!editor) return;
    let action: { dispose(): void } | undefined;
    try {
      action = editor.addAction({
        id: "piwood.addToChat",
        label: "添加到对话",
        contextMenuGroupId: "navigation",
        contextMenuOrder: 0,
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL],
        run: (ed) => addSelectionToChat(ed),
      });
    } catch {
      /* HMR 中旧实例销毁瞬间注册失败可忽略，下轮 effect 重挂 */
    }
    return () => {
      try {
        action?.dispose();
      } catch {
        /* 旧实例已销毁 */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSelectionToChat, editorReady]);

  // 筛选：输入即搜（防抖），回车语义保留
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    const t = setTimeout(() => {
      void window.pi.fsSearch(q).then((r) => setSearchResults(r as Array<{ path: string }>)).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  /** arborist 行渲染器：缩进参考线 + 旋转 chevron + 文件类型彩色图标（VSCode 资源管理器样式） */
  function Node({ node, style, dragHandle }: NodeRendererProps<FsEntry>): React.JSX.Element {
    const d = node.data;
    const dir = d.type === "dir";
    return (
      <div
        ref={dragHandle}
        style={{ ...style, left: 0 }}
        className={cn(
          "flex cursor-pointer select-none items-center gap-1 pr-2 text-[13px] text-foreground outline-none",
          node.isSelected ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60",
        )}
        onClick={() => {
          if (!dir) {
            node.select();
            return;
          }
          node.focus();
          ensureChildren(d.path);
          node.toggle();
        }}
      >
        {/* 缩进参考线：每级一条，落在上一级 chevron 中心下 */}
        {Array.from({ length: node.level }).map((_, i) => (
          <span key={i} className="pointer-events-none absolute inset-y-0 w-px bg-foreground/[0.07]" style={{ left: i * INDENT + 9 }} />
        ))}
        <span className="shrink-0" style={{ width: 4 + node.level * INDENT }} />
        {dir ? (
          <Icon
            name="chevronRight"
            className={cn("shrink-0 text-muted-foreground transition-transform", node.isOpen ? "rotate-90" : "")}
          />
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <FileIcon name={d.name} dir={dir} open={node.isOpen} />
        <span className="truncate">{d.name}</span>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex h-full min-h-0">
      {!engineReady ? (
        <div className="flex h-full flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
          <p>{activeProject ? "引擎未就绪：启动失败，请在设置中检查模型与 API Key 后重选项目。" : "选择一个项目后即可浏览和编辑文件。"}</p>
        </div>
      ) : (
        <>
          {/* 左：文件内容（面包屑 + 常开编辑器） */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
              {active ? (
                <>
                  <Breadcrumb path={active.path} />
                  {active.dirty && <span className="shrink-0 text-sm leading-none text-warning">*</span>}
                  <Button variant="ghost" size="sm" className="h-6 shrink-0" onClick={() => saveRef.current()} disabled={!active.dirty}>
                    保存
                  </Button>
                </>
              ) : (
                <span className="font-mono text-xs text-muted-foreground">/</span>
              )}
              {status && <span className="shrink-0 text-xs text-muted-foreground">{status}</span>}
            </div>
            <div className="cm-host relative min-h-0 flex-1 overflow-hidden">
              {active ? (
                <Editor
                  value={active.content}
                  theme="piwood-dark"
                  language={monacoLanguage(active.path)}
                  options={{
                    fontSize: 12,
                    fontFamily: "Menlo, Consolas, monospace",
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    smoothScrolling: true,
                    padding: { top: 6 },
                  }}
                  onMount={(editor) => {
                    viewRef.current = editor;
                    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
                    setEditorReady(true);
                  }}
                  onChange={(value) =>
                    setOpenFiles((fs) =>
                      fs.map((f) =>
                        f.path === active.path ? { ...f, content: value ?? "", dirty: f.content !== (value ?? "") } : f,
                      ),
                    )
                  }
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Icon name="folder" className="size-10 text-muted-foreground/50" strokeWidth={1} />
                  <p className="text-sm text-foreground">打开文件</p>
                  <p className="text-xs">从工作区目录树中选择文件</p>
                </div>
              )}
              {/* 选中浮标：非空选区上方浮现「添加到对话」（Trae/Cursor 同款；onMouseDown 抢在编辑器失焦前触发） */}
              {active && selTag && (
                <div className="pointer-events-none absolute inset-0 z-10">
                  <button
                    type="button"
                    className="pointer-events-auto absolute flex h-6 items-center gap-1 rounded-md border border-border bg-[var(--composer-chip-bg)] px-2 text-[11px] text-foreground shadow-[0_8px_24px_-8px_rgba(0,0,0,0.7)] transition-[background-color,transform] hover:bg-accent motion-safe:active:scale-[0.96]"
                    style={{ top: selTag.top, left: selTag.left }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const editor = viewRef.current;
                      if (editor) addSelectionToChat(editor);
                      setSelTag(null);
                    }}
                  >
                    <Icon name="message" className="size-3" />
                    添加到对话
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 分隔条：拖拽调树宽 */}
          <div
            role="separator"
            aria-orientation="vertical"
            className="w-px shrink-0 cursor-col-resize bg-border transition-colors hover:bg-ring"
            onMouseDown={(e) => {
              e.preventDefault();
              const move = (ev: MouseEvent): void => {
                const rect = rootRef.current?.getBoundingClientRect();
                if (!rect) return;
                setTreeW(Math.min(Math.max(rect.right - ev.clientX, TREE_MIN_W), Math.max(rect.width * 0.6, TREE_MIN_W)));
              };
              const up = (): void => {
                window.removeEventListener("mousemove", move);
                window.removeEventListener("mouseup", up);
              };
              window.addEventListener("mousemove", move);
              window.addEventListener("mouseup", up);
            }}
          />

          {/* 右：文件树（筛选 + 树） */}
          <div style={{ width: treeW }} className="flex shrink-0 flex-col border-l border-border">
            <div className="shrink-0 border-b border-border/60 p-1.5">
              <Input
                className="h-8"
                value={search}
                placeholder="筛选文件…"
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setSearch("")}
              />
            </div>
            <div ref={treeWrapRef} className="min-h-0 flex-1 overflow-hidden">
              {searchResults ? (
                <div className="h-full overflow-auto py-1">
                  {searchResults.length === 0 && <p className="p-2 text-xs text-muted-foreground">无匹配</p>}
                  {searchResults.map((r) => (
                    <div
                      key={r.path}
                      className="flex h-[22px] cursor-pointer select-none items-center gap-1.5 px-2 text-[13px] text-foreground hover:bg-sidebar-accent/60"
                      onClick={() => openFile({ ...r, name: r.path.split(/[\\/]/).pop() ?? r.path, type: "file" })}
                    >
                      <FileIcon name={r.path} />
                      <span className="truncate text-muted-foreground">{r.path}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {treeSize.h > 0 && (
                    <Tree
                      data={treeRoot}
                      idAccessor="path"
                      childrenAccessor={(d) => d.children ?? (d.type === "dir" ? [] : null)}
                      width={treeSize.w}
                      height={treeSize.h}
                      rowHeight={ROW_HEIGHT}
                      indent={INDENT}
                      openByDefault={false}
                      selection={activeFile}
                      disableDrag
                      disableDrop
                      disableEdit
                      disableMultiSelection
                      onToggle={(id) => ensureChildren(id)}
                      onSelect={(nodes) => {
                        const n = nodes[0];
                        if (n && n.data.type === "file") openFile(n.data);
                      }}
                      overscanCount={12}
                      aria-label="项目文件树"
                    >
                      {Node}
                    </Tree>
                  )}
                  {treeRoot.length === 0 && (
                    <p className="p-2 text-xs text-muted-foreground">{status || "（空目录）"}</p>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export type { OpenFile };
