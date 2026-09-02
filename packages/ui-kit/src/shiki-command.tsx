import { memo, useEffect, useState } from "react";
import { codeToHtml } from "shiki";
import { cn } from "./cn";

/**
 * T5.4 工具紧凑显示：命令文本的 shiki 语法高亮（shell 语法），供 ToolCard 折叠行（inline）
 * 与展开命令块（block）复用。要点：
 * - 模块级缓存 + 上限，虚拟化列表里重复/大量命令只高亮一次，避免每次挂载都跑 async codeToHtml；
 * - 解析完成前先回退纯 mono 文本（不闪空白），完成后换成语义色 token；
 * - shiki 输出的是带内联 style 的 `<pre>`，用 `!bg-transparent !text-inherit` 压掉其自带
 *   底色/基色（内联 style 优先级高于类，故需 important），让 token span 的颜色自然落到外层容器。
 */

const SHELL_THEME = "github-dark-default";
const MAX_CACHE = 1500;

const cache = new Map<string, string>();
function cached(key: string): string | undefined {
  return cache.get(key);
}
function putCache(key: string, html: string): void {
  if (cache.size >= MAX_CACHE) cache.clear(); // 简单软上限，防长会话内存无界增长
  cache.set(key, html);
}

function useShellHtml(code: string, lang: string): string | null {
  const key = `${lang}\0${code}`;
  const [html, setHtml] = useState<string | null>(() => cached(key) ?? null);

  useEffect(() => {
    if (!code) {
      setHtml(null);
      return;
    }
    const hit = cached(key);
    if (hit !== undefined) {
      setHtml(hit);
      return;
    }
    let cancelled = false;
    codeToHtml(code, { lang, theme: SHELL_THEME })
      .then((h) => {
        putCache(key, h);
        if (!cancelled) setHtml(h);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [key, code, lang]);

  return html;
}

export interface HighlightedCommandProps {
  code: string;
  /** 折叠行内联一行；false 为展开命令块（保留换行）。 */
  inline?: boolean;
  className?: string;
}

const INLINE_CSS =
  "inline-block max-w-full overflow-hidden whitespace-nowrap align-bottom [&>pre]:m-0 [&>pre]:inline [&>pre]:overflow-hidden [&>pre]:!bg-transparent [&>pre]:!text-inherit [&>pre]:p-0 [&>pre]:font-mono [&>pre]:[line-height:inherit] [&>pre]:whitespace-nowrap [&_code]:p-0 [&_code]:[font-family:inherit]";
const BLOCK_CSS =
  "min-w-0 [&>pre]:m-0 [&>pre]:bg-transparent [&>pre]:!text-inherit [&>pre]:p-0 [&>pre]:font-mono [&>pre]:whitespace-pre-wrap [&>pre]:break-all [&>pre]:leading-[1.55] [&_code]:p-0 [&_code]:[font-family:inherit]";

export const HighlightedCommand = memo(function HighlightedCommand({
  code,
  inline = false,
  className,
}: HighlightedCommandProps): React.JSX.Element {
  const html = useShellHtml(code, "shell");
  if (html) {
    // 受信任的静态高亮 HTML（shiki 仅输出 span+style，无脚本）
    return <span className={cn(inline ? INLINE_CSS : BLOCK_CSS, className)} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <span
      className={cn(
        "min-w-0 font-mono text-foreground/90",
        inline ? "truncate align-bottom" : "whitespace-pre-wrap break-all",
        className,
      )}
    >
      {code}
    </span>
  );
});
