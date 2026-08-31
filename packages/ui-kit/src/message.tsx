import { cn } from "./cn";
import { Markdown } from "./markdown";

/**
 * prompt-kit Message（https://prompt-kit.com/docs/message）适配版：
 * 结构与官方一致（Message 横向 flex 行 + MessageContent 气泡/prose 容器），
 * Avatar 用首字母徽标实现、MessageAction 的 tooltip 用原生 title 实现，
 * 去掉 Radix Avatar/Tooltip 依赖。
 */
export type MessageProps = {
  children: React.ReactNode;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

const Message = ({ children, className, ...props }: MessageProps) => (
  <div className={cn("pk-message", className)} {...props}>
    {children}
  </div>
);

export type MessageAvatarProps = {
  src?: string;
  alt: string;
  fallback?: string;
  className?: string;
};

const MessageAvatar = ({ src, alt, fallback, className }: MessageAvatarProps) => (
  <span className={cn("pk-avatar", className)} role="img" aria-label={alt}>
    {src ? <img src={src} alt={alt} /> : (fallback ?? alt.slice(0, 2))}
  </span>
);

export type MessageContentProps = {
  children: React.ReactNode;
  markdown?: boolean;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

const MessageContent = ({
  children,
  markdown = false,
  className,
  ...props
}: MessageContentProps) => {
  const classNames = cn("pk-message-content", className);

  return markdown ? (
    <Markdown className={classNames} {...props}>
      {children as string}
    </Markdown>
  ) : (
    <div className={classNames} {...props}>
      {children}
    </div>
  );
};

export type MessageActionsProps = {
  children: React.ReactNode;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

const MessageActions = ({ children, className, ...props }: MessageActionsProps) => (
  <div className={cn("pk-message-actions", className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = {
  tooltip: React.ReactNode;
  children: React.ReactNode;
  className?: string;
} & React.HTMLProps<HTMLSpanElement>;

const MessageAction = ({ tooltip, children, className, ...props }: MessageActionProps) => (
  <span
    className={cn("pk-message-action", className)}
    title={typeof tooltip === "string" ? tooltip : undefined}
    {...props}
  >
    {children}
  </span>
);

export { Message, MessageAvatar, MessageContent, MessageActions, MessageAction };
