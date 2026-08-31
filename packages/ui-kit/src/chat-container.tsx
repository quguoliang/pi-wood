import { StickToBottom } from "use-stick-to-bottom";
import { cn } from "./cn";

/**
 * prompt-kit ChatContainer（https://prompt-kit.com/docs/chat-container）。
 * 基于 use-stick-to-bottom 的智能跟随滚动：用户在底部时新内容自动跟随，
 * 上翻阅读时不打断，回到底部恢复跟随。initial="smooth" 确保历史消息
 * 挂载时也从顶部滚动到底部（默认 "instant" 会停留在顶部）。
 */
export type ChatContainerRootProps = {
  children: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>;

export type ChatContainerContentProps = {
  children: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>;

export type ChatContainerScrollAnchorProps = {
  className?: string;
  ref?: React.RefObject<HTMLDivElement>;
} & React.HTMLAttributes<HTMLDivElement>;

function ChatContainerRoot({ children, className, ...props }: ChatContainerRootProps) {
  return (
    <StickToBottom
      className={cn("pk-chat-root", className)}
      resize="smooth"
      initial="smooth"
      role="log"
      {...props}
    >
      {children}
    </StickToBottom>
  );
}

function ChatContainerContent({ children, className, ...props }: ChatContainerContentProps) {
  return (
    <StickToBottom.Content className={cn("pk-chat-content", className)} {...props}>
      {children}
    </StickToBottom.Content>
  );
}

function ChatContainerScrollAnchor({ className, ...props }: ChatContainerScrollAnchorProps) {
  return <div className={cn("pk-chat-anchor", className)} aria-hidden="true" {...props} />;
}

export { ChatContainerRoot, ChatContainerContent, ChatContainerScrollAnchor };
