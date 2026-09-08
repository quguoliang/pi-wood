import { useEffect, useRef, useState } from "react";
import { ChevronRight, Maximize2, Minus, Monitor, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * macOS 自绘红绿灯（透明窗无系统白线；系统忽略 trafficLightPosition，故自绘）。
 * 绿键 hover 菜单按原生（Sequoia）复刻：「移动与调整大小」四宫格缩略图 +
 * 「填充与排列」四宫格缩略图 + 「全屏幕」子菜单 + 「移到 <显示器>」行；
 * 点击绿键 = 进/出全屏。红=关闭、黄=最小化；符号悬停浮现、绝对层居中；失焦变灰。
 */

type Tile = "left" | "right" | "top" | "bottom" | "fill" | "left23" | "right23" | "quadTL";

/** 原生式平铺缩略图：屏幕框内白色块表示窗口落位 */
function TileGlyph({ tile }: { tile: Tile }): React.JSX.Element {
  const on = "rounded-[2px] bg-white/85 group-hover/tile:bg-white";
  const off = "rounded-[2px] bg-white/25 group-hover/tile:bg-white/45";
  const frame = "grid h-[26px] w-[42px] gap-[2px] rounded-[5px] bg-white/10 p-[3px] transition-colors group-hover/tile:bg-white/25";
  switch (tile) {
    case "left":
      return <span className={cn(frame, "grid-cols-2")}><i className={on} /><i className={off} /></span>;
    case "right":
      return <span className={cn(frame, "grid-cols-2")}><i className={off} /><i className={on} /></span>;
    case "top":
      return <span className={cn(frame, "grid-rows-2")}><i className={on} /><i className={off} /></span>;
    case "bottom":
      return <span className={cn(frame, "grid-rows-2")}><i className={off} /><i className={on} /></span>;
    case "fill":
      return <span className={frame}><i className={on} /></span>;
    case "left23":
      return <span className={cn(frame, "grid-cols-3")}><i className={cn(on, "col-span-2")} /><i className={off} /></span>;
    case "right23":
      return <span className={cn(frame, "grid-cols-3")}><i className={off} /><i className={cn(on, "col-span-2")} /></span>;
    case "quadTL":
      return <span className={cn(frame, "grid-cols-2 grid-rows-2")}><i className={on} /><i className={on} /><i className={on} /><i className={on} /></span>;
  }
}

export function WindowLights(): React.JSX.Element | null {
  const [focused, setFocused] = useState(() => document.hasFocus());
  const [menuOpen, setMenuOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [displays, setDisplays] = useState<{ id: number; label: string }[]>([]);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const onFocus = (): void => setFocused(true);
    const onBlur = (): void => {
      setFocused(false);
      setMenuOpen(false);
      setSubOpen(false);
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    const offFs = window.pi.onWinFullscreenChanged(setFullScreen);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      offFs();
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      setSubOpen(false);
      return;
    }
    void window.pi.winListDisplays().then(setDisplays).catch(() => setDisplays([]));
  }, [menuOpen]);

  // 进全屏即清空菜单状态：组件只是 return null，状态若残留，退全屏瞬间会「自动弹出」
  useEffect(() => {
    if (fullScreen) {
      setMenuOpen(false);
      setSubOpen(false);
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
    }
  }, [fullScreen]);

  // 全屏时让位给系统原生红绿灯（主进程已恢复原生按钮）——必须放在所有 hooks 之后
  if (fullScreen) return null;

  const dot = "app-no-drag relative size-[14px] rounded-full border transition-colors";
  const glyphBox = "pointer-events-none absolute inset-0 grid place-items-center";
  const glyph = "size-[10px] text-black/75 opacity-0 transition-opacity group-hover/lights:opacity-100";

  const greenEnter = (): void => {
    clearTimeout(closeTimer.current);
    openTimer.current = setTimeout(() => setMenuOpen(true), 2000);
  };
  const greenLeave = (): void => {
    clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(() => setMenuOpen(false), 250);
  };
  const pick = (fn: () => void): void => {
    fn();
    setMenuOpen(false);
  };

  const tileBtn = "app-no-drag group/tile grid place-items-center rounded-[7px] p-[5px] transition-colors hover:bg-[#2f6cf7]";
  const row = "app-no-drag flex w-full items-center gap-2 rounded-[6px] px-2 py-[5px] text-left text-[13px] leading-5 text-white/90 transition-colors hover:bg-[#2f6cf7] hover:text-white";
  const label = "px-2 pb-1.5 pt-2 text-[11.5px] font-medium text-white/50";
  const panel = "app-no-drag rounded-xl border border-white/10 bg-[#2a2a2c]/[0.94] p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.5)] backdrop-blur-2xl";

  return (
    <>
      <div className="group/lights absolute left-[26px] top-[21px] z-30 flex items-center gap-[7px]" role="group" aria-label="窗口控制">
        <button type="button" aria-label="关闭" className={cn(dot, focused ? "border-[#e2463c] bg-[#ff5f57]" : "border-transparent bg-[#4b4b4e]")} onClick={() => void window.pi.winClose()}>
          <span className={glyphBox}><X className={glyph} strokeWidth={3} /></span>
        </button>
        <button type="button" aria-label="最小化" className={cn(dot, focused ? "border-[#dfa126] bg-[#febc2e]" : "border-transparent bg-[#4b4b4e]")} onClick={() => void window.pi.winMinimize()}>
          <span className={glyphBox}><Minus className={glyph} strokeWidth={3} /></span>
        </button>
        <button
          type="button"
          aria-label="窗口平铺与全屏"
          className={cn(dot, focused ? "border-[#1aab29] bg-[#28c840]" : "border-transparent bg-[#4b4b4e]")}
          onMouseEnter={greenEnter}
          onMouseLeave={greenLeave}
          onClick={() => void window.pi.winFullScreenToggle()}
        >
          <span className={glyphBox}><Maximize2 className={glyph} strokeWidth={3} /></span>
        </button>
      </div>

      {menuOpen && (
        <div className={cn(panel, "absolute left-[22px] top-[42px] z-40 w-[236px]")} onMouseEnter={greenEnter} onMouseLeave={greenLeave}>
          <div className={label}>移动与调整大小</div>
          <div className="grid grid-cols-4 gap-1 px-0.5">
            <button type="button" className={tileBtn} onClick={() => pick(() => void window.pi.winSetTile("left"))} aria-label="左半屏"><TileGlyph tile="left" /></button>
            <button type="button" className={tileBtn} onClick={() => pick(() => void window.pi.winSetTile("right"))} aria-label="右半屏"><TileGlyph tile="right" /></button>
            <button type="button" className={tileBtn} onClick={() => pick(() => void window.pi.winSetTile("top"))} aria-label="上半屏"><TileGlyph tile="top" /></button>
            <button type="button" className={tileBtn} onClick={() => pick(() => void window.pi.winSetTile("bottom"))} aria-label="下半屏"><TileGlyph tile="bottom" /></button>
          </div>
          <div className={label}>填充与排列</div>
          <div className="grid grid-cols-4 gap-1 px-0.5">
            <button type="button" className={tileBtn} onClick={() => pick(() => void window.pi.winSetTile("fill"))} aria-label="填充屏幕"><TileGlyph tile="fill" /></button>
            <button type="button" className={tileBtn} onClick={() => pick(() => void window.pi.winSetTile("left23"))} aria-label="左侧三分之二"><TileGlyph tile="left23" /></button>
            <button type="button" className={tileBtn} onClick={() => pick(() => void window.pi.winSetTile("right23"))} aria-label="右侧三分之二"><TileGlyph tile="right23" /></button>
            <button type="button" className={tileBtn} onClick={() => pick(() => void window.pi.winSetTile("quadTL"))} aria-label="左上四分之一"><TileGlyph tile="quadTL" /></button>
          </div>
          <div className="my-1.5 h-px bg-white/10" />
          <div className="relative" onMouseEnter={() => setSubOpen(true)} onMouseLeave={() => setSubOpen(false)}>
            <button type="button" className={row}>
              <Maximize2 className="size-[13px]" /> 全屏幕
              <ChevronRight className="ml-auto size-3.5 opacity-60" />
            </button>
            {subOpen && (
              <div className={cn(panel, "absolute left-full top-[-4px] z-50 ml-1.5 w-[118px] space-y-0.5")}>
                <button type="button" className={row} onClick={() => pick(() => void window.pi.winFullScreenToggle())}>整个屏幕</button>
                <button type="button" className={row} onClick={() => pick(() => void window.pi.winSetTile("left"))}>屏幕左侧</button>
                <button type="button" className={row} onClick={() => pick(() => void window.pi.winSetTile("right"))}>屏幕右侧</button>
              </div>
            )}
          </div>
          {displays.map((d) => (
            <button key={d.id} type="button" className={row} onClick={() => pick(() => void window.pi.winMoveToDisplay(d.id))}>
              <Monitor className="size-[13px]" /> 移到 “{d.label}”
            </button>
          ))}
        </div>
      )}
    </>
  );
}
