import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "../../stores/settings-store";

/**
 * 设置「工作树」页（T8.11-R2）：T8.0 起 toast 一直指向「设置 → 工作树」但该页从未存在，此处补齐。
 * 两部分：① worktree 开关（enabled / keepAfterClose，主进程 conversation-registry 读同一段配置）；
 * ② 当前项目的未回收工作树（孤儿对账，engine:worktreeList）——脏树拒绝删除，可显式强制。
 */

interface OrphanRow {
  path: string;
  branch?: string;
}

export function WorktreeSettingsPanel(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings);
  const patch = useSettingsStore((s) => s.patch);
  const [orphans, setOrphans] = useState<OrphanRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [forced, setForced] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = (await window.pi.worktreeList?.().catch(() => [])) as OrphanRow[];
      setOrphans(list ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setWorktree = (next: Partial<{ enabled: boolean; keepAfterClose: boolean }>): void => {
    void patch({ worktree: { ...settings.worktree, ...next } });
  };

  const remove = async (row: OrphanRow, force: boolean): Promise<void> => {
    try {
      const r = (await window.pi.worktreeRemove?.({ path: row.path, force })) as { ok?: boolean; reason?: string };
      if (r?.ok) {
        setForced((current) => {
          const next = new Set(current);
          next.delete(row.path);
          return next;
        });
      } else if (r?.reason) {
        toast.warning(r.reason);
        if (force) return;
        setForced((current) => new Set(current).add(row.path)); // 失败后该行升级为「强制回收」
      }
    } catch (err) {
      toast.error(String((err as Error)?.message ?? err));
    }
    void refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px]">启用独立工作树</div>
            <p className="text-[11px] text-muted-foreground">每条对话在 &lt;项目&gt;/.pi-wood/worktrees/ 下获得一棵独立 git worktree，文件改动物理隔离（关闭时回收）。</p>
          </div>
          <Switch checked={settings.worktree.enabled} onCheckedChange={(v) => setWorktree({ enabled: v })} aria-label="启用独立工作树" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px]">关闭对话后保留工作树</div>
            <p className="text-[11px] text-muted-foreground">缺省关闭即回收；打开后树与分支保留（脏树无论如何都会保留并提示）。</p>
          </div>
          <Switch checked={settings.worktree.keepAfterClose} onCheckedChange={(v) => setWorktree({ keepAfterClose: v })} aria-label="关闭对话后保留工作树" />
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-muted-foreground">当前项目的未回收工作树</h3>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={() => void refresh()}>
            <RefreshCw className="size-3" /> 刷新
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground/70">激活某个项目后此处列出它的孤儿工作树（不属任何活跃对话，多来自上次会话）。</p>
        {loading && <p className="px-1 py-1 text-xs text-muted-foreground">扫描中…</p>}
        {!loading && orphans.length === 0 && <p className="px-1 py-1 text-xs text-muted-foreground/70">没有未回收的工作树。</p>}
        {orphans.map((row) => (
          <div key={row.path} className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[11px]" title={row.path}>
                {row.path}
              </div>
              {row.branch && <div className="text-[11px] text-muted-foreground">{row.branch}</div>}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => void remove(row, forced.has(row.path))}
            >
              <Trash2 className="size-3" /> {forced.has(row.path) ? "强制回收" : "回收"}
            </Button>
          </div>
        ))}
      </section>
    </div>
  );
}
