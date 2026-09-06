import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArchiveRestore, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/time";
import { useSessionMetaStore } from "../../stores/session-meta-store";

/**
 * 设置「归档」页（T8.11-R2，用户裁定）：归档的会话不再进左栏目录树，统一在这里管理。
 * 数据 = 注册项目 × 其磁盘会话 × 元数据 archived 标记；恢复即清标记（回到项目会话列表）。
 */

interface ProjectRecord {
  id: string;
  path: string;
  name: string;
}

interface SessionItem {
  file: string;
  id: string;
  name?: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
}

interface ArchivedRow {
  projectName: string;
  session: SessionItem;
}

export function ArchiveSettingsPanel(): React.JSX.Element {
  const [rows, setRows] = useState<ArchivedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingDeleteFile, setPendingDeleteFile] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const projects = (await window.pi.projectList().catch(() => [])) as ProjectRecord[];
      await useSessionMetaStore.getState().load();
      const out: ArchivedRow[] = [];
      for (const project of projects) {
        const sessions = (await window.pi.sessionsList(project.path).catch(() => [])) as SessionItem[];
        for (const session of sessions) {
          if (useSessionMetaStore.getState().meta[session.file]?.archived) {
            out.push({ projectName: project.name, session });
          }
        }
      }
      out.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
      setRows(out);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const titleOf = (session: SessionItem): string =>
    useSessionMetaStore.getState().meta[session.file]?.alias ?? session.name ?? session.firstMessage ?? "空会话";

  const restore = async (file: string): Promise<void> => {
    await useSessionMetaStore.getState().set(file, { archived: false });
    toast("已恢复到原项目的会话列表");
    void refresh();
  };

  const remove = async (file: string): Promise<void> => {
    try {
      await window.pi.sessionsDelete?.(file);
      toast("会话已删除", { description: "会话文件已永久删除" });
    } catch (err) {
      toast.error(String((err as Error)?.message ?? err));
    }
    setPendingDeleteFile(null);
    void refresh();
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">归档的会话不进左栏目录树；恢复后回到原项目，删除则永久移除（CLI 亦不可恢复）。</p>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={() => void refresh()}>
          <RefreshCw className="size-3" /> 刷新
        </Button>
      </div>
      {loading && <p className="px-1 py-2 text-xs text-muted-foreground">扫描中…</p>}
      {!loading && rows.length === 0 && (
        <p className="px-1 py-2 text-xs text-muted-foreground/70">暂无归档会话。在左栏会话行的「⋯」菜单里选择「归档」即可收进来。</p>
      )}
      {rows.map(({ projectName, session }) => (
        <div key={session.file} className="group flex items-center gap-2 rounded-md border border-border/60 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px]">{titleOf(session)}</div>
            <div className="text-[11px] text-muted-foreground">
              {projectName} · {formatRelativeTime(session.modified)} · {session.messageCount} 条消息
            </div>
          </div>
          {pendingDeleteFile === session.file ? (
            <>
              <span className="shrink-0 text-[11px] text-destructive">永久删除？</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => void remove(session.file)}>
                删除
              </Button>
              <Button variant="ghost" size="icon-sm" className="size-6" aria-label="取消" onClick={() => setPendingDeleteFile(null)}>
                <X className="size-3" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => void restore(session.file)}>
                <ArchiveRestore className="size-3" /> 恢复
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => setPendingDeleteFile(session.file)}
              >
                <Trash2 className="size-3" /> 删除…
              </Button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
