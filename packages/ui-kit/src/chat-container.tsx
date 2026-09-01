import { StickToBottom } from "use-stick-to-bottom";
import { cn } from "./cn";

export type ChatContainerRootProps = React.HTMLAttributes<HTMLDivElement>;
export type ChatContainerContentProps = React.HTMLAttributes<HTMLDivElement>;
export type ChatContainerScrollAnchorProps = React.HTMLAttributes<HTMLDivElement>;

function ChatContainerRoot({ className, children, ...props }: ChatContainerRootProps) {
  return (
    <StickToBottom
      className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", className)}
      resize="smooth"
      initial="smooth"
      role="log"
      {...props}
    >
      {children}
    </StickToBottom>
  );
}

function ChatContainerContent({ className, children, ...props }: ChatContainerContentProps) {
  return (
    <StickToBottom.Content className={cn("flex w-full flex-col", className)} {...props}>
      {children}
    </StickToBottom.Content>
  );
}

function ChatContainerScrollAnchor({ className, ...props }: ChatContainerScrollAnchorProps) {
  return <div aria-hidden className={cn("h-px w-full shrink-0 scroll-mt-24", className)} {...props} />;
}

export { ChatContainerRoot, ChatContainerContent, ChatContainerScrollAnchor };
