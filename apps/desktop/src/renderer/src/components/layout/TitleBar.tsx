import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Icon } from "../ui/Icon";

/**
 * Windows（frame:false）专用自绘标题条：左=项目栏开关，中=拖拽区，右=窗口控制按钮。
 * macOS 不再使用全宽顶栏：红绿灯悬浮在左栏顶部自定义栏上，开关按钮由 AppShell 悬浮渲染，
 * 圆角卡片四边 12px 直接贴窗。非 Windows 平台本组件返回 null。
 */
export function TitleBar({ onToggleSidebar }: { onToggleSidebar(): void }): React.JSX.Element | null {
  const isWindows = window.pi.platform === "win32";
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isWindows) return;
    void window.pi.winIsMaximized().then(setMaximized);
    return window.pi.onWinMaximizeChanged(setMaximized);
  }, [isWindows]);

  if (!isWindows) return null;

  const captionBtn =
    "app-no-drag grid h-full w-[46px] place-items-center text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground";

  return (
    <header className="app-drag flex h-10 shrink-0 select-none items-center gap-1 bg-surface-chrome pr-0">
      <Button variant="ghost" size="icon-sm" className="app-no-drag ml-2 text-muted-foreground hover:text-foreground" onClick={onToggleSidebar} aria-label="展开或收起项目栏">
        <Icon name="panel" size={15} />
      </Button>

      <span className="min-w-6 flex-1" />

      <div className="ml-2 flex h-full items-stretch">
        <button type="button" className={captionBtn} onClick={() => void window.pi.winMinimize()} aria-label="最小化">
          <Minus className="size-4" strokeWidth={1} />
        </button>
        <button type="button" className={captionBtn} onClick={() => void window.pi.winMaximizeToggle()} aria-label={maximized ? "向下还原" : "最大化"}>
          {maximized ? <Copy className="size-[13px]" strokeWidth={1.2} /> : <Square className="size-[13px]" strokeWidth={1.2} />}
        </button>
        <button type="button" className={cn(captionBtn, "hover:bg-[#c42b1c] hover:text-white")} onClick={() => void window.pi.winClose()} aria-label="关闭">
          <X className="size-4" strokeWidth={1} />
        </button>
      </div>
    </header>
  );
}
