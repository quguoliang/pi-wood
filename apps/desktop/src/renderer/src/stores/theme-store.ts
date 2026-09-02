import { create } from "zustand";
import { setShikiTheme } from "@pi-wood/ui-kit";
import {
  resolvePiTheme,
  themeModeFromFg,
  piThemeToCssVars,
  piThemeToTerminalTheme,
  piThemeToShikiTheme,
  type PiThemeColors,
} from "../lib/theme-adapter";

/**
 * T3.3 主题 store：把引擎返回的 Pi 主题（settings.theme.pi 指向 ~/.pi/agent/themes/<name>.json）
 * 应用到全局——写 :root CSS 变量（换肤整个 var 驱动的 app：chrome/内容/Markdown/CodeMirror/dockview）、
 * 切 data-theme 底色层、设 shiki 代码主题（按明暗）、算 xterm 终端配色供 TerminalPanel 消费。
 * 无 Pi 主题（未配置/文件缺失）→ 清除本 store 施加的覆盖，交回内置 light/dark/system。
 */

interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
}

interface ThemeState {
  active: boolean;
  name: string | null;
  mode: "dark" | "light";
  colors: PiThemeColors;
  terminalTheme: TerminalTheme | null;
  /** 应用一个 Pi 主题（null = 清除覆盖，回退内置）。 */
  apply(theme: { name: string; vars: Record<string, string | number>; colors: Record<string, string | number> } | null): void;
}

let appliedKeys: string[] = [];

function writeVars(vars: Record<string, string>): void {
  clearVars();
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
    appliedKeys.push(k);
  }
}

function clearVars(): void {
  const root = document.documentElement;
  for (const k of appliedKeys) root.style.removeProperty(k);
  appliedKeys = [];
}

function currentSurface(mode: "dark" | "light"): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
  return v || (mode === "light" ? "#ffffff" : "#181818");
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  active: false,
  name: null,
  mode: "dark",
  colors: {},
  terminalTheme: null,
  apply(theme) {
    if (!theme) {
      clearVars();
      setShikiTheme("github-dark-default");
      set({ active: false, name: null, colors: {}, terminalTheme: null });
      return;
    }
    const colors = resolvePiTheme(theme);
    const mode = themeModeFromFg(colors.text);
    document.documentElement.dataset.theme = mode;
    writeVars(piThemeToCssVars(colors));
    setShikiTheme(piThemeToShikiTheme(colors, mode) ?? (mode === "light" ? "github-light-default" : "github-dark-default"));
    set({
      active: true,
      name: theme.name,
      mode,
      colors,
      terminalTheme: piThemeToTerminalTheme(colors, currentSurface(mode)),
    });
    // 终端 surface 依赖 --background（刚切 data-theme 后需一帧才稳定），下一帧回填
    requestAnimationFrame(() => {
      if (get().active) {
        set({ terminalTheme: piThemeToTerminalTheme(colors, currentSurface(mode)) });
      }
    });
  },
}));
