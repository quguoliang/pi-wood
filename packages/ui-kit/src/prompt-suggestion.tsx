import { Button, type ButtonProps } from "./button";
import { cn } from "./cn";

export type PromptSuggestionProps = { children: React.ReactNode } & ButtonProps;

function PromptSuggestion({ children, variant, size, className, ...props }: PromptSuggestionProps) {
  return (
    <Button
      variant={variant ?? "outline"}
      size={size ?? "sm"}
      className={cn("h-auto rounded-full px-3 py-1.5 text-xs font-normal text-muted-foreground hover:text-foreground", className)}
      {...props}
    >
      {children}
    </Button>
  );
}

export { PromptSuggestion };
