import { CheckCircle, ChevronDown, Loader2, Settings, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "./button";
import { cn } from "./cn";

export type ToolPart = {
  type: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  toolCallId?: string;
  errorText?: string;
};

export type ToolProps = { toolPart: ToolPart; defaultOpen?: boolean; className?: string };

const stateMeta: Record<ToolPart["state"], { icon: React.ReactNode; badge: string; label: string }> = {
  "input-streaming": { icon: <Loader2 className="size-4 animate-spin text-primary" />, badge: "bg-primary/15 text-primary", label: "Running" },
  "input-available": { icon: <Settings className="size-4 text-warning" />, badge: "bg-warning/15 text-warning", label: "Ready" },
  "output-available": { icon: <CheckCircle className="size-4 text-success" />, badge: "bg-success/15 text-success", label: "Completed" },
  "output-error": { icon: <XCircle className="size-4 text-destructive" />, badge: "bg-destructive/15 text-destructive", label: "Error" },
};

const formatValue = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }
  return String(value);
};

const Tool = ({ toolPart, defaultOpen = false, className }: ToolProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const { state, input, output, toolCallId } = toolPart;
  const meta = stateMeta[state];

  return (
    <div className={cn("mx-auto w-full max-w-[var(--pk-chat-width,46rem)] overflow-hidden rounded-lg border bg-card/40", className)}>
      <Button
        variant="ghost"
        className="h-auto w-full justify-between rounded-none px-3 py-2 font-normal hover:bg-accent"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          {meta.icon}
          <span className="font-mono text-xs">{toolPart.type}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", meta.badge)}>{meta.label}</span>
        </span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
      </Button>
      {isOpen && (
        <div className="grid gap-3 border-t bg-card/20 p-3">
          {input && Object.keys(input).length > 0 && (
            <div>
              <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">Input</h4>
              <div className="rounded-md border bg-background p-2 font-mono text-xs">
                {Object.entries(input).map(([key, value]) => (
                  <div key={key} className="mb-1 break-all last:mb-0">
                    <span className="text-muted-foreground">{key}:</span> <span>{formatValue(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {output && (
            <div>
              <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">Output</h4>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-background p-2 font-mono text-xs">{formatValue(output)}</pre>
            </div>
          )}
          {state === "output-error" && toolPart.errorText && (
            <div>
              <h4 className="mb-1.5 text-xs font-medium text-destructive">Error</h4>
              <div className="break-all rounded-md border border-destructive/25 bg-destructive/10 p-2 font-mono text-xs">{toolPart.errorText}</div>
            </div>
          )}
          {state === "input-streaming" && <div className="text-xs text-muted-foreground">Processing tool call…</div>}
          {toolCallId && <div className="border-t pt-2 text-[11px] text-muted-foreground"><span className="font-mono">Call ID: {toolCallId}</span></div>}
        </div>
      )}
    </div>
  );
};

export { Tool };
