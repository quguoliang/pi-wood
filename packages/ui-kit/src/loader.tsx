import { cn } from "./cn";

export type LoaderProps = {
  variant?: "typing" | "spinner";
  size?: "sm" | "md" | "lg";
  text?: string;
  className?: string;
};

const dotSize: Record<NonNullable<LoaderProps["size"]>, string> = {
  sm: "size-1",
  md: "size-1.5",
  lg: "size-2",
};

function TypingLoader({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const s = dotSize[size];
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn("animate-bounce rounded-full bg-primary", s)}
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: "1s" }}
        />
      ))}
    </div>
  );
}

function Loader({ variant = "typing", size = "md", text, className }: LoaderProps) {
  return (
    <div className={cn("mx-auto flex w-full max-w-[var(--pk-chat-width,46rem)] items-center gap-2 mb-5", className)}>
      <TypingLoader size={size} />
      {text && <span className="text-xs text-muted-foreground">{text}</span>}
    </div>
  );
}

export { Loader };
