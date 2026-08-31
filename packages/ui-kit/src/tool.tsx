import {
  CheckCircle,
  ChevronDown,
  Loader2,
  Settings,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Button } from "./button";
import { cn } from "./cn";

/**
 * prompt-kit Tool（https://prompt-kit.com/docs/tool）官方对齐版：
 * 边框卡片 + ghost Button 触发头（状态图标 + mono 工具名 + 彩色 pill 徽标 + chevron），
 * 默认收起；展开后 Input 键值对列表 / Output mono 块 / Error 块 / Call ID。
 * 配色落到 shadcn 语义令牌（--border/--muted/--primary…，见 styles.css 映射层）。
 */
export type ToolPart = {
  type: string;
  state:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error";
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  toolCallId?: string;
  errorText?: string;
};

export type ToolProps = {
  toolPart: ToolPart;
  defaultOpen?: boolean;
  className?: string;
};

const Tool = ({ toolPart, defaultOpen = false, className }: ToolProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const { state, input, output, toolCallId } = toolPart;

  const getStateIcon = () => {
    switch (state) {
      case "input-streaming":
        return <Loader2 className="pk-tool-icon is-streaming" />;
      case "input-available":
        return <Settings className="pk-tool-icon is-ready" />;
      case "output-available":
        return <CheckCircle className="pk-tool-icon is-done" />;
      case "output-error":
        return <XCircle className="pk-tool-icon is-error" />;
      default:
        return <Settings className="pk-tool-icon" />;
    }
  };

  const getStateBadge = () => {
    switch (state) {
      case "input-streaming":
        return <span className="pk-tool-badge is-streaming">Processing</span>;
      case "input-available":
        return <span className="pk-tool-badge is-ready">Ready</span>;
      case "output-available":
        return <span className="pk-tool-badge is-done">Completed</span>;
      case "output-error":
        return <span className="pk-tool-badge is-error">Error</span>;
      default:
        return <span className="pk-tool-badge">Pending</span>;
    }
  };

  const formatValue = (value: unknown): string => {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") return value;
    if (typeof value === "object") {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    return String(value);
  };

  return (
    <div className={cn("pk-tool", className)}>
      <Button
        variant="ghost"
        className="pk-tool-trigger"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((v) => !v)}
      >
        <span className="pk-tool-heading">
          {getStateIcon()}
          <span className="pk-tool-name">{toolPart.type}</span>
          {getStateBadge()}
        </span>
        <ChevronDown className={cn("pk-tool-chevron", isOpen && "is-open")} />
      </Button>
      {isOpen && (
        <div className="pk-tool-body">
          <div className="pk-tool-sections">
            {input && Object.keys(input).length > 0 && (
              <div>
                <h4 className="pk-tool-label">Input</h4>
                <div className="pk-tool-panel">
                  {Object.entries(input).map(([key, value]) => (
                    <div key={key} className="pk-tool-kv">
                      <span className="pk-tool-key">{key}:</span>{" "}
                      <span>{formatValue(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {output && (
              <div>
                <h4 className="pk-tool-label">Output</h4>
                <div className="pk-tool-panel pk-tool-output">
                  <pre>{formatValue(output)}</pre>
                </div>
              </div>
            )}

            {state === "output-error" && toolPart.errorText && (
              <div>
                <h4 className="pk-tool-label is-error">Error</h4>
                <div className="pk-tool-panel pk-tool-error">{toolPart.errorText}</div>
              </div>
            )}

            {state === "input-streaming" && (
              <div className="pk-tool-processing">Processing tool call...</div>
            )}

            {toolCallId && (
              <div className="pk-tool-callid">
                <span>Call ID: {toolCallId}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export { Tool };
