import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Windows 自绘窗口控制（撤全宽 TitleBar 后的唯一窗口控制入口）：
 * 悬浮在窗口右上角、嵌在右栏开关按钮右侧的紧凑自定义钮——
 * 关闭=红底白字、最小化/最大化=ghost，最大化态切换还原图标。
 * 位置与卡内 header 同一水平带（对话 header / 右栏 nav 均为其预留右侧空间）。
 */
export function WinWindowControls(): React.JSX.Element | null {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void window.pi.winIsMaximized().then(setMaximized);
    return window.pi.onWinMaximizeChanged(setMaximized);
  }, []);

  const btn =
    "app-no-drag grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground";

  return (
    // 容器自身 app-drag（与 header 拖拽带 union，抓按钮间隙也能拖窗）；按钮 no-drag 是
    // drag 元素的后代——Electron 区域扣减对「后代 no-drag」才可靠，分离式 overlay 的
    // no-drag 会被 DOM 更后的 app-drag 带重新盖住（实测按钮点不动）。
    <div className="app-drag absolute right-2 top-[14px] z-30 flex items-center gap-0.5" role="group" aria-label="窗口控制">
      <button type="button" className={btn} onClick={() => void window.pi.winMinimize()} aria-label="最小化" title="最小化">
        <Minus className="size-4" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        className={btn}
        onClick={() => void window.pi.winMaximizeToggle()}
        aria-label={maximized ? "向下还原" : "最大化"}
        title={maximized ? "向下还原" : "最大化"}
      >
        {maximized ? <Copy className="size-[13px]" strokeWidth={1.5} /> : <Square className="size-[13px]" strokeWidth={1.5} />}
      </button>
      <button
        type="button"
        className={cn(btn, "hover:bg-[#c42b1c] hover:text-white")}
        onClick={() => void window.pi.winClose()}
        aria-label="关闭"
        title="关闭"
      >
        <X className="size-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
