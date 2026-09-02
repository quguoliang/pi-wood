import { useSyncExternalStore } from "react";

/**
 * T3.3 ui-kit 侧主题注册表：宿主（桌面）解析 Pi 主题后调用 setShikiTheme，
 * code-block / shiki-command 通过 useShikiTheme() 订阅当前代码高亮主题——
 * 既支持内置主题名（string），也支持从 Pi 语法 token 生成的自定义主题对象；
 * 主题切换会触发订阅组件重渲染 → 重新高亮（token 级换肤）。
 */

export interface ShikiThemeObject {
  name: string;
  type: "dark" | "light";
  colors: Record<string, string>;
  tokenColors: Array<{ scope: string | string[]; settings: Record<string, string | undefined> }>;
}

export type ShikiThemeInput = string | ShikiThemeObject;

let current: ShikiThemeInput = "github-dark-default";
let version = 0;
const listeners = new Set<() => void>();

export function setShikiTheme(theme: ShikiThemeInput): void {
  current = theme;
  version += 1;
  for (const l of listeners) l();
}

/** 非响应式读取（供缓存 key 等）。 */
export function getShikiTheme(): ShikiThemeInput {
  return current;
}

/** 主题标识（字符串名或对象 name），用于高亮缓存 key，切主题即失效重算。 */
export function shikiThemeKey(): string {
  return `${typeof current === "string" ? current : current.name}#${version}`;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React 订阅：主题变化触发使用方重渲染。 */
export function useShikiTheme(): ShikiThemeInput {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
