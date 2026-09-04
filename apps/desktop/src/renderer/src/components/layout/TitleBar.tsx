import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useActiveConversation, useSessionStore } from "../../stores/session-store";
import { Icon } from "../ui/Icon";

/**
 * UI v3 全宽标题栏（参考 ZCode/Windows 风格）：
 * 左=品牌+侧栏开关，中=拖拽区（双击最大化由 OS 处理），右=引擎状态/浮层开关+窗口控制。
 * macOS（hiddenInset 红绿灯）：左侧留 78px 空位、不渲染窗口按钮。
 */
export function TitleBar({
  leftCollapsed,
  onToggleSidebar,
}: {
  leftCollapsed: boolean;
  onToggleSidebar(): void;
}): React.JSX.Element {
  const isWindows = window.pi.platform === "win32";
  const [maximized, setMaximized] = useState(false);
  const engineReady = useActiveConversation((c) => c.engineReady);
  const activeProject = useSessionStore((s) => s.activeProject);
  const engineState = engineReady ? "Pi 引擎就绪" : activeProject ? "引擎未就绪" : "等待项目";

  useEffect(() => {
    if (!isWindows) return;
    void window.pi.winIsMaximized().then(setMaximized);
    return window.pi.onWinMaximizeChanged(setMaximized);
  }, [isWindows]);

  const captionBtn =
    "app-no-drag grid h-full w-[46px] place-items-center text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground";

  return (
    <header className="app-drag flex h-10 shrink-0 select-none items-center gap-1 bg-surface-chrome pr-0">
      {!isWindows && <span className="w-[78px] shrink-0" />}
      <div className="flex items-center gap-2 pl-3">
        <span className="grid size-[22px] place-items-center rounded-md bg-primary text-[12px] font-bold text-primary-foreground">π</span>
        <span className="text-[13px] font-semibold tracking-tight">pi-wood</span>
      </div>
      <Button variant="ghost" size="icon-sm" className="app-no-drag ml-1 text-muted-foreground hover:text-foreground" onClick={onToggleSidebar} aria-label="展开或收起项目栏">
        <Icon name="panel" size={15} />
      </Button>
      {leftCollapsed && (
        <Button variant="ghost" size="icon-sm" className="app-no-drag text-muted-foreground hover:text-foreground" onClick={() => window.dispatchEvent(new Event("piwood:new-session"))} aria-label="新建会话">
          <Icon name="add" size={16} />
        </Button>
      )}

      <span className="min-w-6 flex-1" />

      <div className="app-no-drag flex h-full items-center gap-1">
        <div className="mr-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <i
            className={cn(
              "size-1.5 rounded-full",
              engineReady
                ? "bg-success shadow-[0_0_8px] shadow-success/60"
                : activeProject
                  ? "bg-warning shadow-[0_0_8px] shadow-warning/60"
                  : "bg-muted-foreground",
            )}
          />
          <span>{engineState}</span>
        </div>
      </div>

      {isWindows && (
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
      )}
    </header>
  );
}
