import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "./cn";
import { Markdown } from "./markdown";

const TooltipProvider = TooltipPrimitive.Provider;
const TooltipRoot = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;
const TooltipContent = TooltipPrimitive.Content;

export type MessageFrom = "user" | "assistant" | "system" | "tool";

export type MessageProps = React.HTMLAttributes<HTMLDivElement> & { from?: MessageFrom };

const alignment: Record<MessageFrom, string> = {
  user: "flex-row-reverse",
  assistant: "flex-row",
  system: "justify-center",
  tool: "flex-row",
};

const Message = ({ children, className, from = "assistant", ...props }: MessageProps) => (
  <div
    data-from={from}
    className={cn("flex w-full items-start gap-3 mx-auto max-w-[var(--pk-chat-width,46rem)] mb-5", alignment[from], className)}
    {...props}
  >
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
  <AvatarPrimitive.Root
    className={cn("relative flex size-7 shrink-0 select-none overflow-hidden rounded-full ring-1 ring-border bg-muted items-center justify-center mt-0.5", className)}
  >
    {src ? <AvatarPrimitive.Image src={src} alt={alt} className="aspect-square size-full object-cover" /> : null}
    <AvatarPrimitive.Fallback className="flex size-full items-center justify-center font-mono text-xs font-semibold text-primary">
      {fallback ?? alt.slice(0, 2)}
    </AvatarPrimitive.Fallback>
  </AvatarPrimitive.Root>
);

export type MessageContentProps = React.HTMLAttributes<HTMLDivElement> & { markdown?: boolean };

const MessageContent = ({ children, markdown = false, className, ...props }: MessageContentProps) =>
  markdown ? (
    <Markdown className={cn("pk-prose min-w-0 max-w-full", className)} {...props}>
      {children as string}
    </Markdown>
  ) : (
    <div className={cn("min-w-0 max-w-[85%] break-words text-sm leading-relaxed", className)} {...props}>
      {children}
    </div>
  );

export type MessageActionsProps = React.HTMLAttributes<HTMLDivElement>;

const MessageActions = ({ children, className, ...props }: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100", className)} {...props}>
    <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
  </div>
);

export type MessageActionProps = {
  tooltip: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

const MessageAction = ({ tooltip, children, className }: MessageActionProps) => (
  <TooltipRoot>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipPrimitive.Portal>
      <TooltipContent
        side="bottom"
        className={cn("z-50 rounded-md border bg-popover px-2.5 py-1 text-xs text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95", className)}
      >
        {tooltip}
      </TooltipContent>
    </TooltipPrimitive.Portal>
  </TooltipRoot>
);

export { Message, MessageAvatar, MessageContent, MessageActions, MessageAction };
