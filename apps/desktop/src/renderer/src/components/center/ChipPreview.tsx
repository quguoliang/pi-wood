import { useRef, useState, type ReactNode } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

const OPEN_DELAY_MS = 200;
const CLOSE_DELAY_MS = 100;

/**
 * 芯片 hover 预览容器（Composer 附件/引用芯片、消息气泡芯片共用）。
 *
 * 手控 Popover + 锚点计时器（MessageMinimap 同款节奏）：enter 200ms 开、leave 100ms 关，
 * 指针移入卡片本体时保持——预览里的长路径/代码片段得以看清，不会被手抖带走。
 */
export function ChipPreview({
  preview,
  children,
  onClick,
  className,
  ariaLabel,
}: {
  preview: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  ariaLabel?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelTimers = (): void => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  };
  const scheduleOpen = (): void => {
    cancelTimers();
    openTimer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  };
  const scheduleClose = (): void => {
    cancelTimers();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  const keep = (): void => cancelTimers();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span
          className={className}
          aria-label={ariaLabel}
          onMouseEnter={scheduleOpen}
          onMouseLeave={scheduleClose}
          onClick={onClick}
          role={onClick ? "button" : undefined}
        >
          {children}
        </span>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        className="w-80 p-3"
        onMouseEnter={keep}
        onMouseLeave={scheduleClose}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {preview}
      </PopoverContent>
    </Popover>
  );
}

/** 预览卡片里的附件内容：图片缩略图 / 文件信息 */
export function AttachmentPreviewBody({
  name,
  path,
  size,
  kind,
  thumb,
}: {
  name: string;
  path: string;
  size: number;
  kind: "file" | "image";
  thumb?: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {kind === "image" && thumb ? (
        <img src={thumb} alt={name} className="max-h-60 w-auto self-start rounded-md border border-border object-contain" />
      ) : null}
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground">{name}</p>
        <p className="truncate text-[11px] text-muted-foreground">{path}</p>
        <p className="text-[11px] text-muted-foreground">{formatSize(size)}</p>
      </div>
    </div>
  );
}

/** 预览卡片里的引用片段内容：位置 + 等宽代码（截 12 行） */
export function SnippetPreviewBody({
  path,
  start,
  end,
  snippet,
}: {
  path: string;
  start: number;
  end: number;
  snippet: string;
}): React.JSX.Element {
  const lines = snippet.split("\n");
  const shown = lines.slice(0, 12).join("\n");
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="truncate font-mono text-[11px] text-muted-foreground">
        {path}:{start}-{end}
      </p>
      <pre className="max-h-56 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-relaxed text-foreground">
        {shown}
        {lines.length > 12 ? `\n…（共 ${lines.length} 行）` : ""}
      </pre>
    </div>
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
