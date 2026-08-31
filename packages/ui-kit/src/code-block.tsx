import { memo, useEffect, useState } from "react";
import { codeToHtml } from "shiki";
import { cn } from "./cn";

/**
 * prompt-kit CodeBlock（https://prompt-kit.com/docs/code-block）适配版：
 * 围栏代码块走 shiki 高亮，供 prompt-kit Markdown 的 components.code 覆盖使用。
 */
export type CodeBlockProps = {
  children?: React.ReactNode;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div className={cn("pk-code-block", className)} {...props}>
      {children}
    </div>
  );
}

export type CodeBlockCodeProps = {
  code: string;
  language?: string;
  theme?: string;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

function CodeBlockCode({
  code,
  language = "plaintext",
  theme = "github-dark-default",
  className,
  ...props
}: CodeBlockCodeProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const render = async (): Promise<void> => {
      if (!code) {
        setHtml(null);
        return;
      }
      try {
        const highlighted = await codeToHtml(code, { lang: language, theme });
        if (!cancelled) setHtml(highlighted);
      } catch {
        if (!cancelled) setHtml(null);
      }
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [code, language, theme]);

  const bodyClass = cn("pk-code-block-body", className);
  if (html) {
    return (
      <div
        className={bodyClass}
        // shiki 输出的受信任静态高亮 HTML（无脚本，仅 span+style）
        dangerouslySetInnerHTML={{ __html: html }}
        {...props}
      />
    );
  }
  return (
    <div className={bodyClass} {...props}>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

const MemoCodeBlockCode = memo(CodeBlockCode);

export { CodeBlock, MemoCodeBlockCode as CodeBlockCode };
