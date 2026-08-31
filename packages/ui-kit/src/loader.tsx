import { cn } from "./cn";

/**
 * prompt-kit Loader（https://prompt-kit.com/docs/loader）精简版：
 * 保留对话流最常用的 typing 三点指示器，视觉由 .pk-loader* 类承接。
 */
export type LoaderProps = {
  variant?: "typing";
  size?: "sm" | "md" | "lg";
  text?: string;
  className?: string;
};

function TypingLoader({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <div className={cn("pk-loader-typing", `is-${size}`)}>
      <span className="pk-loader-dot" />
      <span className="pk-loader-dot" />
      <span className="pk-loader-dot" />
    </div>
  );
}

function Loader({ variant = "typing", size = "md", text, className }: LoaderProps) {
  return (
    <div className={cn("pk-loader", className)}>
      <TypingLoader size={size} />
      {text && <span className="pk-loader-text">{text}</span>}
    </div>
  );
}

export { Loader };
