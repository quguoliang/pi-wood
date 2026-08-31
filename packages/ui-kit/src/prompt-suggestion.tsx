import { Button, type ButtonProps } from "./button";
import { cn } from "./cn";

/**
 * prompt-kit PromptSuggestion（https://prompt-kit.com/docs/prompt-suggestion）
 * 常规模式：圆角描边按钮，点击把建议语填入输入框。
 */
export type PromptSuggestionProps = {
  children: React.ReactNode;
} & ButtonProps;

function PromptSuggestion({ children, variant, size, className, ...props }: PromptSuggestionProps) {
  return (
    <Button
      variant={variant ?? "outline"}
      size={size ?? "sm"}
      className={cn("pk-suggestion", className)}
      {...props}
    >
      {children}
    </Button>
  );
}

export { PromptSuggestion };
