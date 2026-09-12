import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/** 判定附件/文件路径是否在当前项目（或其 worktree）目录下：都归一成正斜杠再比前缀 */
export function isUnderProject(path: string, projectDirs: Array<string | undefined>): boolean {
  const norm = (p: string): string => p.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
  const p = norm(path);
  return projectDirs.some((dir) => {
    if (!dir) return false;
    const d = norm(dir);
    return p === d || p.startsWith(`${d}/`);
  });
}

/**
 * 独立图片预览器（大图 Dialog）：消息气泡/输入框里「不属于当前项目」的图片芯片点击后走这里，
 * 不与右栏文件查看器混用（项目内图片才进文件面板——FilesPanel 自己有图片渲染通路）。
 * thumb 缺席时按需 fs:thumb 现取（历史消息的附件元数据可能没存缩略图）。
 */
export function ImagePreviewDialog({
  target,
  onClose,
}: {
  /** null = 关闭；thumb 缺席时组件自行 fsThumb(path) 补取 */
  target: { name: string; path: string; thumb?: string } | null;
  onClose(): void;
}): React.JSX.Element {
  const [src, setSrc] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!target) return;
    setSrc(target.thumb);
    setFailed(false);
    if (target.thumb) return;
    let alive = true;
    window.pi
      .fsThumb(target.path)
      .then((t) => {
        if (!alive) return;
        if (t) setSrc(t);
        else setFailed(true);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [target]);

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl p-3" aria-label={target?.name ?? "图片预览"}>
        <div className="flex max-h-[75vh] items-center justify-center overflow-hidden rounded-md bg-muted/40">
          {src ? (
            <img src={src} alt={target?.name} className="max-h-[75vh] w-auto object-contain" />
          ) : failed ? (
            <p className="p-8 text-xs text-muted-foreground">无法加载图片预览</p>
          ) : (
            <p className="p-8 text-xs text-muted-foreground">载入中…</p>
          )}
        </div>
        <div className="mt-2 min-w-0 text-center">
          <p className="truncate text-xs font-medium text-foreground">{target?.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{target?.path}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
