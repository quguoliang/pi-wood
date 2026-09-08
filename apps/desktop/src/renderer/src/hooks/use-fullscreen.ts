import { useEffect, useState } from "react";

/** macOS 原生全屏状态（订阅 win:onFullscreenChanged；非 darwin 恒为 false） */
export function useFullScreen(): boolean {
  const [fs, setFs] = useState(false);
  useEffect(() => {
    if (window.pi.platform !== "darwin") return;
    return window.pi.onWinFullscreenChanged(setFs);
  }, []);
  return fs;
}
