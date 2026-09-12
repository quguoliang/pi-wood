import { useCallback, useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import type { editor as monacoEditor } from "monaco-editor";
import { Tree, type NodeRendererProps, type TreeApi } from "react-arborist";
import { isImagePath } from "@pi-wood/ipc-schema";
import { monaco, monacoLanguage } from "@/lib/monaco-setup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FileIcon } from "@/lib/file-icons";
import { requirePi } from "@/lib/preload-api";
import { Icon } from "../ui/Icon";
import { useSessionStore } from "../../stores/session-store";
import { useConversationsStore } from "../../stores/conversations-store";
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

/**
 * 右栏打开的一个文件。
 *
 * `image` 是**三态**，刻意这样编码而不是另加一个 `kind` 字段：
 * - `undefined` = 文本文件 → 走 Monaco（`content` 是正文）
 * - `string`    = 图片文件且读到了 → 走图片视图（`content` 恒为 ""）
 * - `null`      = 图片文件但读不出来 → 走图片视图的失败态
 *
 * 「是不是图片」由扩展名（`isImagePath`，与主进程解码共用一份清单）判定，
 * 不能由「fsRead 有没有抛错」反推——那样会先拿到一个「二进制不支持预览」的报错再补救。
 */
interface OpenFile {
  path: string;
  content: string;
  dirty: boolean;
  image?: string | null;
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

/** 浅比较两个目录列表（name/type 序列相同即视为未变）——StrictMode 双拉同目录时保住树对象身份 */
function sameEntries(a: FileEntry[] | undefined, b: FileEntry[]): boolean {
  if (!a || a.length !== b.length) return false;
  const key = (e: FileEntry): string => `${e.type}:${e.name}`;
  const sa = a.map(key).sort();
  const sb = b.map(key).sort();
  return sa.every((k, i) => k === sb[i]);
}

/** dirPath 目录在树里现有的 children（未展开过则为 undefined） */
function findChildren(root: FsEntry[], dirPath: string): FsEntry[] | undefined {
  if (dirPath === "") return root;
  const walk = (nodes: FsEntry[]): FsEntry[] | undefined => {
    for (const n of nodes) {
      if (n.path === dirPath) return n.children;
      const hit = n.children ? walk(n.children) : undefined;
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(root);
}

/** path 是否已作为节点存在于嵌套树中（含未展开目录下的子节点） */
function nodeInTree(nodes: FsEntry[], path: string): boolean {
  return nodes.some((n) => n.path === path || (n.children ? nodeInTree(n.children, path) : false));
}

/** arborist 行渲染器：缩进参考线 + 旋转 chevron + 文件类型彩色图标（VSCode 资源管理器样式）。
 *  必须定义在模块级：定义在组件内会让每次 re-render 都是新的组件类型 → 所有行卸载重挂 = 整树抖动。
 *  点击语义全走 arborist 自身（目录 toggle 触发 onToggle 拉 children；文件 select 触发 onSelect 打开），
 *  因此不需要任何组件内闭包。 */
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
        node.toggle(); // open/close 内部会回调 props.onToggle(id) → ensureChildren 拉取子目录
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

/**
 * 图片视图（右栏预览的本体）。
 *
 * 刻意不用 `<img>` 外包一层 flex 居中：超宽图会被压扁到容器宽、超长图会被截断。
 * 改成「内层可滚动 + `max-w-full`」——小图居中、大图按原始像素铺开并让容器出滚动条，
 * 这是看图工具的基本行为（等价于 `object-fit: none` 但保留了缩放到容器宽的能力）。
 */
function ImagePreview({ file, onDecodeError }: { file: OpenFile; onDecodeError: () => void }): React.JSX.Element {
  const name = file.path.split(/[\\/]/).pop() ?? file.path;
  if (!file.image) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
        <Icon name="image" className="size-10 text-muted-foreground/50" />
        <p className="text-sm text-foreground">无法预览该图片</p>
        <p className="max-w-md break-all text-xs text-muted-foreground/80">{file.path}</p>
        <p className="text-xs text-muted-foreground/60">支持 png / jpg / jpeg / webp / gif；文件可能已删除、超过 16MB 或已损坏</p>
      </div>
    );
  }
  return (
    <div className="h-full min-h-0 overflow-auto p-3">
      <img
        src={file.image}
        alt={name}
        title={file.path}
        onError={onDecodeError}
        className="mx-auto block max-w-full rounded-md border border-border object-contain shadow-[0_10px_30px_-18px_rgba(0,0,0,0.9)]"
      />
    </div>
  );
}

export function FilesPanel(): React.JSX.Element {
  const activeProject = useSessionStore((s) => s.activeProject);
  const activeConversationId = useSessionStore((s) => s.activeConversationId);
  // 文件树根 = fs:* 解析的工作区根（当前对话 worktree → 主项目），reveal 绝对路径时优先按它归一
  const worktreeRoot = useConversationsStore((s) => s.rows.find((r) => r.id === activeConversationId)?.worktreePath);
  // 「工作区键」= 树的作废边界：只有当前对话的 worktree 或主项目变了才重建树。
  // 切对话（同工作区）不在此列——engineReady 是发送防护不是清场信号（T8.3 后续结论），
  // 拿它清树会把同一项目的文件树在切对话时整块闪成「引擎未就绪」空屏（用户报障）。
  const wsKey = worktreeRoot ?? activeProject ?? "";
  const requestedFile = useWorkbenchStore((s) => s.requestedFile);
  const clearRequestedFile = useWorkbenchStore((s) => s.clearRequestedFile);
  const [treeRoot, setTreeRoot] = useState<FsEntry[]>([]);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | undefined>();
  // 树选中高亮与编辑器激活分离：点击即时高亮（selectedPath），内容加载完成后才切换编辑器（activeFile）——
  // 否则 activeFile 先行、openFiles 还没有该文件 → 编辑器整块卸载成「打开文件」占位再重挂，表现为点击后整体抖动一次
  const [selectedPath, setSelectedPath] = useState<string | undefined>();
  // 已加载/进行中的文件去重（openFiles 只增不减，无关 tab 入口，ref 判定即可）：双击同一文件不加重复 tab、不重复 fsRead
  const inflightLoads = useRef<Set<string>>(new Set());
  const loadedPaths = useRef<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ path: string }> | null>(null);
  const [status, setStatus] = useState("");
  // 根目录拉取中（首屏/换工作区）；与「引擎没起来」区分，别把加载态写成失败文案
  const [rootLoading, setRootLoading] = useState(false);
  const [treeW, setTreeW] = useState(TREE_DEFAULT_W);
  const [pendingReveal, setPendingReveal] = useState<{ path: string; line: number } | null>(null);
  // react-arborist：懒加载目录集合（"" = 根）+ 树高度测量（react-window 需要像素值）
  const loadedDirs = useRef<Set<string>>(new Set());
  // 目录 children 缓存：revealPath 逐层展开时要按 name 找到真实节点 id（分隔符/大小写与树一致）
  const dirEntriesCache = useRef<Map<string, FileEntry[]>>(new Map());
  // 进行中拉取去重：StrictMode effect 双跑 / reveal 下钻与手动展开并发时，同目录只发一次 fs:tree
  const dirLoadsInflight = useRef<Map<string, Promise<FileEntry[]>>>(new Map());
  // 命令式树 API（展开祖先 + 滚动定位到文件）
  const treeRef = useRef<TreeApi<FsEntry> | null>(null);
  const treeWrapRef = useRef<HTMLDivElement>(null);
  const [treeSize, setTreeSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // 待定位文件：等树数据提交 + Tree 挂载（treeSize 有值）后，由 effect 执行 openParents/scrollTo
  const [revealTarget, setRevealTarget] = useState<string | null>(null);
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
    // 工作区根 = fs:* 解析口径（当前对话 worktree → 主项目）。只有切项目/换 worktree 才作废树，
    // 切对话（同一工作区）不动它——engineReady 是**发送防护**，不是清场信号（T8.3 后续结论）。
    // 旧实现拿 engineReady 当清场开关，切对话的 1~2s 里 engineReady=false → 整块树被清空、
    // 亮出「引擎未就绪：启动失败…」空屏，引擎就绪后若该切片没被重新置位就永久卡死（用户报障）。
    setTreeRoot([]);
    loadedDirs.current = new Set();
    dirEntriesCache.current.clear();
    dirLoadsInflight.current.clear();
    setOpenFiles([]);
    setActiveFile(undefined);
    setSelectedPath(undefined);
    loadedPaths.current.clear();
    inflightLoads.current.clear();
    setPendingReveal(null);
    setRevealTarget(null);
    setStatus("");
    // 首屏/换工作区主动拉根目录：树不能只靠用户先点开某个目录才懒加载，
    // 否则根目录永远不进树（loadedDirs 只记被展开的目录，根没人点）。
    if (!wsKey) return;
    setRootLoading(true);
    loadedDirs.current.add("");
    // 惰性启动：启动竞态下 fs:tree 可能赶在主进程 peek（设置工作区）之前发出而报
    // 「引擎未启动」——这种失败是暂时的，短暂退避重试几次（激活完成后 fs 域即恢复）。
    const attempt = (left: number): void => {
      void loadChildren(undefined)
        .then((entries) => {
          dirEntriesCache.current.set("", entries);
          setTreeRoot(toFsEntries(entries));
        })
        .catch((err) => {
          loadedDirs.current.delete("");
          const message = String(err?.message ?? err);
          if (left > 0 && message.includes("引擎未启动")) {
            window.setTimeout(() => attempt(left - 1), 800);
            return;
          }
          setStatus(message);
        })
        .finally(() => setRootLoading(false));
    };
    attempt(3);
  }, [wsKey, loadChildren]);

  // 展开目录前确保 children 已拉取（onToggle 对点击与键盘展开都生效，幂等）
  const ensureChildren = useCallback(
    (dirPath: string): void => {
      if (loadedDirs.current.has(dirPath)) return;
      loadedDirs.current.add(dirPath);
      void loadChildren(dirPath || undefined)
        .then((entries) => {
          dirEntriesCache.current.set(dirPath, entries);
          setTreeRoot((root) =>
            sameEntries(findChildren(root, dirPath), entries) ? root : mergeChildren(root, dirPath, toFsEntries(entries)),
          );
        })
        .catch(() => loadedDirs.current.delete(dirPath));
    },
    [loadChildren],
  );

  /** 取某目录 children（缓存优先；未缓存则拉取 + 合入树 + 返回）。"" / undefined = 项目根。 */
  const loadDirEntries = useCallback(
    async (dir: string | undefined): Promise<FileEntry[]> => {
      const key = dir ?? "";
      const cached = dirEntriesCache.current.get(key);
      if (cached) return cached;
      // 同目录并发拉取只发一次：后到调用直接复用 pending（StrictMode 双跑的关键去重）
      const pending = dirLoadsInflight.current.get(key);
      if (pending) return pending;
      loadedDirs.current.add(key);
      const p = (loadChildren(dir) as Promise<FileEntry[]>)
        .then((entries) => {
          dirEntriesCache.current.set(key, entries);
          // 内容没变的重复拉取不替换树对象——否则整体新数组会把 arborist 的展开状态冲掉
          setTreeRoot((root) =>
            sameEntries(findChildren(root, key), entries) ? root : mergeChildren(root, key, toFsEntries(entries)),
          );
          return entries;
        })
        .catch((err) => {
          loadedDirs.current.delete(key);
          throw err;
        })
        .finally(() => dirLoadsInflight.current.delete(key));
      dirLoadsInflight.current.set(key, p);
      return p;
    },
    [loadChildren],
  );

  /**
   * 把文件树逐层展开到 path（「打开」联动）：自顶向下用真实子节点 id 定位每一级目录，
   * 数据合入树后再经 TreeApi.openParents + scrollTo 完成展开与定位。
   * 任何一级在树里找不到（被忽略/已删除）就安静放弃展开——文件本身照常打开。
   */
  const revealPath = useCallback(
    async (path: string): Promise<void> => {
      // 树节点 id 是「相对工作区根、正斜杠」路径（fs:tree 口径，与 git status 输出一致）；
      // 入参可能是绝对路径（其它调用方）→ 先归一到相对 id，后面全部按相对 id 走。
      let rel = path.replace(/\\/g, "/").replace(/\/+$/, "");
      const candidates = [worktreeRoot, activeProject].filter((r): r is string => Boolean(r));
      for (const root of candidates) {
        const rootNorm = root.replace(/[\\/]+$/, "").replace(/\\/g, "/");
        if (rootNorm && rel.startsWith(`${rootNorm}/`)) {
          rel = rel.slice(rootNorm.length + 1);
          break;
        }
      }
      rel = rel.replace(/^\/+/, "");
      if (!rel) return;
      const dirs = rel.split("/").slice(0, -1).filter(Boolean);
      let parentDir: string | undefined; // undefined = 项目根
      for (const seg of dirs) {
        const entries = await loadDirEntries(parentDir);
        const hit = entries.find((e) => e.name === seg && e.type === "dir");
        if (!hit) return;
        parentDir = hit.path;
      }
      // 关键：目标文件节点只有在其**直接父目录**的 children 合入树后才存在。
      // 循环只把各级目录自身载入（最后一个 parentDir 的 children 还没拉），这里补上——
      // 否则 arborist 的 openParents/scrollTo 按 id 找不到节点，展开与定位全部静默失效。
      await loadDirEntries(parentDir);
      setSelectedPath(rel);
      setRevealTarget(rel); // 交给下面的 effect：等树数据/Tree 就绪后再展开 + 滚动
    },
    [activeProject, worktreeRoot, loadDirEntries],
  );

  // 树就绪（数据已提交 + Tree 已挂载测得高度）后，才执行命令式展开/滚动——
  // 早于此刻 treeRef.current 为 null 或目标节点尚未进树，openParents/scrollTo 会静默失效。
  useEffect(() => {
    if (!revealTarget) return;
    const api = treeRef.current;
    if (!api || treeSize.h <= 0) return; // Tree 未挂载 → 等 treeSize 变化后本 effect 重跑
    // 目标节点此刻必须已在树里（revealPath 已把直接父目录 children 合入）；找不到就放弃，不再挂起重试。
    // 注意不能用 api.get()——它只查「可见」节点，而祖先目录尚未展开，目标必然不可见；须查整棵树数据。
    if (!nodeInTree(treeRoot, revealTarget)) {
      setRevealTarget(null);
      return;
    }
    api.openParents(revealTarget);
    const raf = requestAnimationFrame(() => {
      // scrollTo 内部 waitFor 到目标进入可见列表；resolve 后目标才可选中，这时显式 select。
      // 不能只靠 selection={selectedPath} 属性：arborist 的选中 effect 只在属性**变化**时跑，
      // 而设置 selectedPath 时祖先还没展开、目标不可见 → 选中落空，之后属性没变也不会补。
      const reveal = (): void => api.select(revealTarget, { focus: false });
      const p = api.scrollTo(revealTarget);
      if (p) void p.then(reveal).catch(() => reveal());
      else reveal();
    });
    setRevealTarget(null);
    return () => cancelAnimationFrame(raf);
  }, [revealTarget, treeRoot, treeSize.h]);

  // 树列尺寸跟随拖拽/面板宽度
  useEffect(() => {
    const el = treeWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTreeSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [treeW]);

  const openFile = useCallback((entry: FileEntry): void => {
    setSelectedPath(entry.path);
    if (inflightLoads.current.has(entry.path)) return;
    if (loadedPaths.current.has(entry.path)) {
      setActiveFile(entry.path);
      return;
    }
    inflightLoads.current.add(entry.path);
    // 图片走 fs:image（原图 dataURL），文本走 fs:read。两条通路必须分开：
    // fs:read 对任何图片都会以「二进制文件不支持预览」抛错，且强行按 utf-8 读会得到乱码。
    // 判定用扩展名（isImagePath，与主进程解码同一份清单），而不是「读了报错再补救」。
    // 整个构造过程包 try：preload 缺函数时抛的是**同步** TypeError，不包就会从 effect 逃出去白屏（见 requirePi）。
    let load: Promise<{ content: string; image: string | null | undefined }>;
    try {
      load = isImagePath(entry.path)
        ? requirePi(window.pi.fsImage, "fsImage")(entry.path).then((dataUrl) => ({ content: "", image: dataUrl ?? null }))
        : requirePi(window.pi.fsRead, "fsRead")(entry.path).then((r) => ({ content: r.content, image: undefined }));
    } catch (err) {
      inflightLoads.current.delete(entry.path);
      setStatus(err instanceof Error ? err.message : String(err));
      return;
    }
    void load
      .then((loaded) => {
        loadedPaths.current.add(entry.path);
        // 内容到位后一次性提交：追加 tab + 切激活（React 18 自动批处理，同帧渲染，无占位闪烁）
        setOpenFiles((fs) =>
          fs.some((f) => f.path === entry.path) ? fs : [...fs, { path: entry.path, dirty: false, ...loaded }],
        );
        setActiveFile(entry.path);
      })
      .catch((err) => setStatus(String(err?.message ?? err)))
      .finally(() => inflightLoads.current.delete(entry.path));
  }, []);

  useEffect(() => {
    if (!requestedFile) return;
    const { path, line } = requestedFile;
    openFile({ path, name: path.split(/[\\/]/).pop() ?? path, type: "file" });
    if (line != null) setPendingReveal({ path, line });
    void revealPath(path).catch(() => undefined); // 目录树逐层展开到该文件并滚动定位；失败不影响已打开的文件
    clearRequestedFile();
  }, [clearRequestedFile, openFile, requestedFile, revealPath]);

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
    // 图片分支不可能置 dirty，这里再挡一次：fsWrite 会把 UTF-8 文本写进 .png，等于把图毁了。
    if (!cur || cur.image !== undefined || !cur.dirty) return;
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

  // 当前激活的是图片（走图片视图）——文本编辑器在这条路径上是**被卸载**的
  const isImageActive = active !== undefined && active.image !== undefined;

  /**
   * 切到图片时把 Monaco 相关引用与浮标清掉。
   *
   * 为什么必须显式清：`viewRef` 是 ref，编辑器组件卸载**不会**把它置空，它会继续指向一个
   * 已被销毁的实例；而「选中浮标」「右键菜单」两个 effect 只看 `editorReady`/`activeFile`
   * 变化，拿到销毁实例后 `getSelection()`/`onDid*` 行为未定义（残留浮标，或切回文本时报错）。
   */
  useEffect(() => {
    if (!isImageActive) return;
    viewRef.current = null;
    setEditorReady(false);
    setSelTag(null);
  }, [isImageActive]);

  return (
    <div ref={rootRef} className="flex h-full min-h-0">
      {!wsKey ? (
        <div className="flex h-full flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
          <p>选择一个项目后即可浏览和编辑文件。</p>
        </div>
      ) : (
        <>
          {/* 左：文件内容（面包屑 + 常开编辑器） */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
              {active ? (
                <>
                  <Breadcrumb path={active.path} />
                  {/* 图片没有正文可改：脏标记与保存按钮都不出现（否则是个永远禁用的按钮） */}
                  {active.image !== undefined ? (
                    <span className="shrink-0 text-xs text-muted-foreground">图片预览</span>
                  ) : (
                    <>
                      {active.dirty && <span className="shrink-0 text-sm leading-none text-warning">*</span>}
                      <Button variant="ghost" size="sm" className="h-6 shrink-0" onClick={() => saveRef.current()} disabled={!active.dirty}>
                        保存
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <span className="font-mono text-xs text-muted-foreground">/</span>
              )}
              {status && <span className="shrink-0 text-xs text-muted-foreground">{status}</span>}
            </div>
            <div className="cm-host relative min-h-0 flex-1 overflow-hidden">
              {active ? (
                active.image !== undefined ? (
                  <ImagePreview file={active} onDecodeError={() => setStatus("图片解码失败，文件可能已损坏")} />
                ) : (
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
                )
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Icon name="folder" className="size-10 text-muted-foreground/50" strokeWidth={1} />
                  <p className="text-sm text-foreground">打开文件</p>
                  <p className="text-xs">从工作区目录树中选择文件</p>
                </div>
              )}
              {/* 选中浮标：非空选区上方浮现「添加到对话」（Trae/Cursor 同款；onMouseDown 抢在编辑器失焦前触发） */}
              {active && active.image === undefined && selTag && (
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
                      ref={treeRef}
                      data={treeRoot}
                      idAccessor="path"
                      childrenAccessor={(d) => d.children ?? (d.type === "dir" ? [] : null)}
                      width={treeSize.w}
                      height={treeSize.h}
                      rowHeight={ROW_HEIGHT}
                      indent={INDENT}
                      openByDefault={false}
                      selection={selectedPath}
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
                    <p className="p-2 text-xs text-muted-foreground">
                      {rootLoading ? "载入中…" : status || "（空目录）"}
                    </p>
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
