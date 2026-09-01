import { memo } from "react";
import { cn } from "./cn";

export interface DiffViewProps {
  /** unified patch（含 ---/+++/@@ 头）或展示型 diff 文本 */
  patch: string;
  className?: string;
  maxRows?: number;
}

type Row = { kind: "add" | "del" | "hunk" | "ctx" | "meta"; text: string };

function parse(patch: string): Row[] {
  const rows: Row[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) rows.push({ kind: "hunk", text: line });
    else if (line.startsWith("+++") || line.startsWith("---")) rows.push({ kind: "meta", text: line });
    else if (line.startsWith("+")) rows.push({ kind: "add", text: line.slice(1) });
    else if (line.startsWith("-")) rows.push({ kind: "del", text: line.slice(1) });
    else rows.push({ kind: "ctx", text: line.startsWith(" ") ? line.slice(1) : line });
  }
  return rows;
}

const kindClass: Record<Row["kind"], string> = {
  add: "bg-success/12 text-success",
  del: "bg-destructive/12 text-destructive",
  hunk: "bg-primary/10 text-primary",
  meta: "text-muted-foreground",
  ctx: "text-foreground/80",
};

const kindSign: Record<Row["kind"], string> = {
  add: "+",
  del: "-",
  hunk: "",
  meta: "",
  ctx: " ",
};

/** 轻量行级 diff 渲染（无编辑器依赖，适合对话流内联大量小 diff）。 */
function DiffViewImpl({ patch, className, maxRows = 400 }: DiffViewProps) {
  const rows = parse(patch).slice(0, maxRows);
  return (
    <div className={cn("overflow-x-auto rounded-md border border-border bg-[#0f1115] font-mono text-[12px] leading-[1.55] dark:bg-[#0b0d10]", className)}>
      <pre className="m-0 py-1">
        {rows.map((r, i) => (
          <div key={i} className={cn("flex px-0", kindClass[r.kind])}>
            <span className="w-6 shrink-0 select-none text-center opacity-70">{kindSign[r.kind]}</span>
            <span className="whitespace-pre pr-3">{r.text || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

export const DiffView = memo(DiffViewImpl);
