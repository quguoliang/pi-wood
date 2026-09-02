import { memo, useEffect, useState } from "react";
import { codeToHtml } from "shiki";
import { cn } from "./cn";
import { getShikiThemeName } from "./theme-registry";

export type CodeBlockProps = React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode };

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn(
        "my-3 flex w-full max-w-full flex-col overflow-hidden rounded-lg border bg-[#0f1115] dark:bg-[#0b0d10]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type CodeBlockCodeProps = React.HTMLAttributes<HTMLDivElement> & {
  code: string;
  language?: string;
  theme?: string;
};

function CodeBlockCode({ code, language = "plaintext", theme, className, ...props }: CodeBlockCodeProps) {
  const [html, setHtml] = useState<string | null>(null);
  const activeTheme = theme ?? getShikiThemeName();

  useEffect(() => {
    let cancelled = false;
    const render = async (): Promise<void> => {
      if (!code) {
        setHtml(null);
        return;
      }
      try {
        const highlighted = await codeToHtml(code, { lang: language, theme: activeTheme });
        if (!cancelled) setHtml(highlighted);
      } catch {
        if (!cancelled) setHtml(null);
      }
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [code, language, activeTheme]);

  const bodyClass = cn("w-full overflow-x-auto text-[12px] [&>pre]:m-0 [&>pre]:bg-transparent [&>pre]:p-3 [&>pre]:font-mono [&>pre]:leading-[1.65] [&>pre>code]:p-0", className);
  if (html) {
    // 受信任的静态高亮 HTML（shiki 仅输出 span+style，无脚本）
    return <div className={bodyClass} dangerouslySetInnerHTML={{ __html: html }} {...props} />;
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
