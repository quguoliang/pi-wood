import { marked } from "marked";
import { memo, useId, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "./cn";
import { CodeBlock, CodeBlockCode } from "./code-block";
import { GenUiBlock } from "./gen-ui";
import { isGenUiLanguage } from "./gen-ui-core";

/**
 * prompt-kit Markdown（https://prompt-kit.com/docs/markdown）移植版：
 * react-markdown + remark-gfm + marked 分块 memo，围栏代码块走 prompt-kit
 * CodeBlock（shiki 高亮）。与官方一致，仅把 Tailwind 类替换为 pk-* 语义类。
 *
 * T11.1 增量：`genui` 围栏（生成式 UI）改由 `createMarkdownComponents` 注入的
 * `GenUiBlock` 渲染。是否识别该围栏由**宿主设置**决定（默认关 = 普通代码块），
 * 因此 components 不再是模块级常量，而由调用方按设置构造。
 */
export type MarkdownProps = {
  children: string;
  id?: string;
  className?: string;
  components?: Partial<Components>;
  /**
   * 渲染身份键：参与分块 memo 的比较与 key。
   * 供「components 变了但 markdown 文本没变」的场景使用（如用户中途打开生成式 UI 开关，
   * 历史消息需要重新解析出 GenUiBlock）——否则 MemoizedMarkdownBlock 会因 content 相同而跳过。
   */
  renderKey?: string | number;
};

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown);
  return tokens.map((token) => token.raw);
}

function extractLanguage(className?: string): string {
  if (!className) return "plaintext";
  const match = className.match(/language-([\w-]+)/);
  return match ? match[1] : "plaintext";
}

/** T11.1：识别生成式 UI 围栏（含模型偶发写出的别名）—— 判定在 ./gen-ui-core.ts（纯逻辑，可单测） */
export type MarkdownRenderOptions = {
  /** 生成式 UI：开启后 `genui` 围栏渲染为沙箱 UI；关闭（默认）时降级为普通代码块 */
  genUi?: boolean;
};

export function createMarkdownComponents(opts: MarkdownRenderOptions = {}): Partial<Components> {
  const genUiEnabled = opts.genUi === true;
  return {
    code: function CodeComponent({ className, children, ...props }) {
      const isInline =
        !props.node?.position?.start.line ||
        props.node?.position?.start.line === props.node?.position?.end.line;

      if (isInline) {
        return (
          <code
            className={cn(
              "rounded-[5px] bg-muted px-1.5 py-0.5 font-mono text-[0.8em] text-foreground",
              className,
            )}
            {...props}
          >
            {children}
          </code>
        );
      }

      const language = extractLanguage(className);
      const source = String(children ?? "");

      if (genUiEnabled && isGenUiLanguage(language)) {
        return <GenUiBlock code={source} />;
      }

      return (
        <CodeBlock className={className}>
          <CodeBlockCode code={source} language={language} />
        </CodeBlock>
      );
    },
    pre: function PreComponent({ children }) {
      return <>{children}</>;
    },
  };
}

const INITIAL_COMPONENTS: Partial<Components> = createMarkdownComponents();

const MemoizedMarkdownBlock = memo(
  function MarkdownBlock({
    content,
    components = INITIAL_COMPONENTS,
  }: {
    content: string;
    components?: Partial<Components>;
    /** 仅参与 memo 比较（见 propsAreEqual）；渲染不消费 */
    renderKey?: string | number;
  }) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {content}
      </ReactMarkdown>
    );
  },
  function propsAreEqual(prevProps, nextProps) {
    return prevProps.content === nextProps.content && prevProps.renderKey === nextProps.renderKey;
  },
);

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock";

function MarkdownComponent({
  children,
  id,
  className,
  components = INITIAL_COMPONENTS,
  renderKey,
}: MarkdownProps) {
  const generatedId = useId();
  const blockId = id ?? generatedId;
  const blocks = useMemo(() => parseMarkdownIntoBlocks(children), [children]);

  return (
    <div className={className}>
      {blocks.map((block, index) => (
        <MemoizedMarkdownBlock
          // renderKey 进 key 与 memo 比较：components 变化（如打开生成式 UI）时强制重解析该块
          key={`${blockId}-block-${index}-${renderKey ?? ""}`}
          content={block}
          components={components}
          {...(renderKey !== undefined ? { renderKey } : {})}
        />
      ))}
    </div>
  );
}

const Markdown = memo(MarkdownComponent);
Markdown.displayName = "Markdown";

export { Markdown };
