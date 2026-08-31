import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "./cn";

/**
 * shadcn/ui Button（无 Radix Slot 依赖的精简版）。
 * 视觉令牌全部落到 .btn-* 类上，由 apps/desktop styles.css 提供，
 * 与 pi-wood 现有设计变量（--line/--hover/--accent…）对齐。
 */
const buttonVariants = cva("btn", {
  variants: {
    variant: {
      default: "btn-default",
      outline: "btn-outline",
      ghost: "btn-ghost",
      secondary: "btn-secondary",
      destructive: "btn-destructive",
    },
    size: {
      default: "btn-md",
      sm: "btn-sm",
      lg: "btn-lg",
      icon: "btn-icon",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
