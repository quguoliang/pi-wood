import { useState } from "react";
import {
  ChevronDown, CircleSlash, FileCode2, FilePen, FilePlus2, FolderOpen, Globe,
  Loader2, Search, Sparkles, Terminal, XCircle,
} from "lucide-react";
import { cn } from "./cn";
import { DiffView } from "./diff";

export interface ToolCardProps {
  name: string;
  args: Record<string, unknown>;
  status: "running" | "ok" | "error";
  output?: string;
  diff?: string;
  diffStat?: { added: number; deleted: number };
  truncated?: boolean;
  defaultOpen?: boolean;
  className?: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : v === undefined ? "" : String(v));
const oneLine = (s: string, max = 72): string => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** 动词 + 目标（对齐 Zcode：终端 / 编辑 / 读取 … + 命令或文件名）。 */
function describe(name: string, args: Record<string, unknown>): { verb: string; target: string; mono: boolean } {
  switch (name) {
    case "read": return { verb: "读取", target: str(args.path), mono: true };
    case "write": return { verb: "写入", target: str(args.path), mono: true };
    case "edit": return { verb: "编辑", target: str(args.path), mono: true };
    case "bash":
    case "powershell": return { verb: "终端", target: oneLine(str(args.command)), mono: true };
    case "grep": return { verb: "搜索", target: str(args.pattern) ? `"${str(args.pattern)}"` : "", mono: false };
    case "find": return { verb: "查找", target: str(args.pattern), mono: false };
    case "ls": return { verb: "列出", target: str(args.path) || ".", mono: true };
    case "agent_start": return { verb: "启动子代理", target: str(args.agent), mono: false };
    case "agent_resume": return { verb: "续跑子代理", target: str(args.id).slice(0, 8), mono: true };
    case "agent_wait": {
      const ids = Array.isArray(args.ids) ? (args.ids as unknown[]).length : 0;
      return { verb: "等待子代理", target: ids > 0 ? `${ids} 个 run` : "", mono: false };
    }
    case "agent_result": return { verb: "子代理结果", target: str(args.id).slice(0, 8), mono: true };
    case "agent_cancel": {
      const ids = Array.isArray(args.ids) ? (args.ids as unknown[]).length : 0;
      return { verb: "取消子代理", target: ids > 0 ? `${ids} 个 run` : "", mono: false };
    }
    case "agent_steer": return { verb: "引导子代理", target: str(args.id).slice(0, 8), mono: true };
    default:
      if (name.startsWith("browser_")) return { verb: "浏览器", target: name.replace("browser_", ""), mono: false };
      return { verb: name, target: oneLine(str(args.path ?? args.command ?? args.pattern ?? "")), mono: true };
  }
}

function headerIcon(name: string, status: ToolCardProps["status"]): React.ReactNode {
  if (status === "running") return <Loader2 className="size-4 shrink-0 animate-spin text-primary" />;
  if (status === "error") return <XCircle className="size-4 shrink-0 text-destructive/70" />;
  switch (name) {
    case "read": return <FileCode2 className="size-4 shrink-0" />;
    case "write": return <FilePlus2 className="size-4 shrink-0" />;
    case "edit": return <FilePen className="size-4 shrink-0" />;
    case "bash":
    case "powershell": return <Terminal className="size-4 shrink-0" />;
    case "grep":
    case "find": return <Search className="size-4 shrink-0" />;
    case "ls": return <FolderOpen className="size-4 shrink-0" />;
    default:
      return name.startsWith("browser_") ? <Globe className="size-4 shrink-0" /> : <CircleSlash className="size-4 shrink-0" />;
  }
}

const outputBlock =
  "max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-[#0f1115] px-2.5 py-2 font-mono text-[12px] leading-[1.55] dark:bg-[#0b0d10]";

/** 从 agent_start / agent_result 的输出文本里解析出 run id（用于关联子代理面板）。 */
function parseSubagentRunId(output: string | undefined): string | undefined {
  if (!output) return undefined;
  const start = output.match(/run id\s+([\w-]+)/);
  if (start) return start[1];
  const result = output.match(/\brun\s+([\w-]+):/);
  return result ? result[1] : undefined;
}

/** 「打开子代理会话」：派发全局事件，右栏 SubagentPanel 监听后打开对应 run 的只读详情。 */
function SubagentOpenButton({ runId }: { runId: string | undefined }): React.JSX.Element | null {
  if (!runId) return null;
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(new CustomEvent("piwood:open-subagent", { detail: { runId } }))
      }
      className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-white/[0.03] px-2 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
    >
      <Sparkles className="size-3.5" />
      打开子代理会话
      <span className="font-mono text-[10px] opacity-60">{runId.slice(0, 8)}</span>
    </button>
  );
}

function ToolBody({ name, args, output, diff, status }: ToolCardProps): React.JSX.Element {
  const isEdit = (name === "edit" || name === "write") && diff;
  if (isEdit) {
    return (
      <div className="mb-1 ml-[7px] mt-1 border-l-2 border-border pl-3">
        <DiffView patch={diff!} />
      </div>
    );
  }
  if (name === "agent_start") {
    const runId = parseSubagentRunId(output);
    return (
      <div className="mb-1 ml-[7px] mt-1 space-y-1 border-l-2 border-border pl-3">
        <div className="text-[12.5px] text-muted-foreground">
          {status === "running" ? (
            "启动中…"
          ) : status === "error" ? (
            <span className="text-destructive">{oneLine(output ?? "启动失败")}</span>
          ) : (
            <>
              子代理已启动：<span className="font-medium text-foreground/90">{str(args.agent) || "subagent"}</span>
              {runId && <span className="font-mono text-[11px] opacity-70"> · run {runId.slice(0, 8)}</span>}
            </>
          )}
        </div>
        {runId && <SubagentOpenButton runId={runId} />}
      </div>
    );
  }
  if (name === "agent_result") {
    const runId = parseSubagentRunId(output);
    return (
      <div className="mb-1 ml-[7px] mt-1 space-y-1.5 border-l-2 border-border pl-3">
        {output ? (
          <pre className={cn(outputBlock, status === "error" && "border-destructive/30 text-destructive")}>{output}</pre>
        ) : (
          <div className="text-[12px] text-muted-foreground">（无输出）</div>
        )}
        {runId && <SubagentOpenButton runId={runId} />}
      </div>
    );
  }
  return (
    <div className="mb-1 ml-[7px] mt-1 space-y-1.5 border-l-2 border-border pl-3">
      {(name === "bash" || name === "powershell") && str(args.command) && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-[#0f1115] px-2.5 py-1.5 font-mono text-[12px] dark:bg-[#0b0d10]">
          <span className="select-none text-success">$</span>
          <span className="whitespace-pre-wrap break-all text-foreground/90">{str(args.command)}</span>
        </div>
      )}
      {name === "read" && (args.offset != null || args.limit != null) && (
        <div className="font-mono text-[11px] text-muted-foreground">
          {str(args.path)}{args.offset ? ` · 行 ${str(args.offset)}` : ""}{args.limit ? ` · ${str(args.limit)} 行` : ""}
        </div>
      )}
      {output ? (
        <pre className={cn(outputBlock, status === "error" && "border-destructive/30 text-destructive")}>{output}</pre>
      ) : status === "running" ? (
        <div className="text-[12px] text-muted-foreground">执行中…</div>
      ) : (
        <div className="text-[12px] text-muted-foreground">（无输出）</div>
      )}
    </div>
  );
}

/** 工具调用：折叠态是一行无边框正文（图标+动词+目标+增删数），点击展开显示 diff/输出。 */
export function ToolCard(props: ToolCardProps): React.JSX.Element {
  const { name, args, status, diffStat, defaultOpen = false, className } = props;
  const [open, setOpen] = useState(defaultOpen);
  const { verb, target, mono } = describe(name, args);
  const hasStat = Boolean(diffStat && (diffStat.added > 0 || diffStat.deleted > 0));
  return (
    <div className={cn("group/tool", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="-mx-2 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors hover:bg-accent/50"
      >
        <span className="shrink-0 text-muted-foreground">{headerIcon(name, status)}</span>
        <span className="shrink-0 font-medium text-foreground/90">{verb}</span>
        {target && <span className={cn("min-w-0 flex-1 truncate text-muted-foreground", mono && "font-mono text-[12.5px]")}>{target}</span>}
        {!target && <span className="min-w-0 flex-1" />}
        {hasStat && (
          <span className="shrink-0 font-mono text-[11px]">
            <span className="text-success">+{diffStat!.added}</span> <span className="text-destructive">-{diffStat!.deleted}</span>
          </span>
        )}
        <ChevronDown
          className={cn(
            "shrink-0 text-muted-foreground transition",
            open ? "opacity-100 rotate-180" : "opacity-0 group-hover/tool:opacity-100",
          )}
          size={14}
        />
      </button>
      {open && <ToolBody {...props} />}
    </div>
  );
}

function fmtDuration(ms?: number): string {
  if (!ms || ms < 1000) return "持续了几秒";
  const s = Math.round(ms / 1000);
  if (s < 60) return `持续了 ${s} 秒`;
  return `持续了 ${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

/** 思考过程：一行正文「思考 · 持续了 N 秒」，点击展开。流式时实时展开。 */
export function ThinkingCard({
  text,
  streaming,
  durationMs,
  defaultOpen = false,
}: {
  text: string;
  streaming?: boolean;
  durationMs?: number;
  defaultOpen?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = streaming ? true : open;
  return (
    <div className="group/tool">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={isOpen}
        className="-mx-2 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        <Sparkles className={cn("size-4 shrink-0", streaming && "animate-pulse text-primary")} />
        <span className="shrink-0 font-medium">思考</span>
        <span className="min-w-0 flex-1 truncate">· {streaming ? "思考中…" : fmtDuration(durationMs)}</span>
        <ChevronDown className={cn("shrink-0 transition", isOpen ? "opacity-100 rotate-180" : "opacity-0 group-hover/tool:opacity-100")} size={14} />
      </button>
      {isOpen && (
        <div className="mb-1 ml-[7px] mt-1 border-l-2 border-border pl-3 text-[12.5px] leading-relaxed whitespace-pre-wrap italic text-muted-foreground">
          {text}
        </div>
      )}
    </div>
  );
}
