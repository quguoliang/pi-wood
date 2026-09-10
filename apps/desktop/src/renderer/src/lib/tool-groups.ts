import type { ConversationItem } from "../stores/session-store";

/**
 * T5.6 连续工具分组：把 items 中连续的 `kind: "tool"` 归为一组（中间无 assistant/user/
 * thinking/system 即视为连续），长度 >=2 才成组，单个工具保持原样（避免「误分组」）。
 * 纯函数、无副作用、无 electron/DOM 依赖，可被 node --test 直接跑。
 */

export type ToolItem = Extract<ConversationItem, { kind: "tool" }>;

export type ToolGroupStatus = "running" | "all_ok" | "has_error";

export interface ToolGroupItem {
  id: string;
  kind: "tool_group";
  tools: ToolItem[];
  status: ToolGroupStatus;
  /** 组内已知 durationMs 之和；全部缺时间戳（如历史回填）时为 undefined。 */
  totalDurationMs?: number;
  okCount: number;
  errorCount: number;
  runningCount: number;
}

/**
 * 轮次过程折叠体：一轮结束后把该轮的思考 / 工具过程收成一行「已完成 · 耗时」，
 * 正文（该轮最后一条 assistant）留在折叠体之外，其余过程行点击展开还原。
 */
export interface TurnProcessItem {
  id: string;
  kind: "turn_process";
  /** 被折叠的过程行（思考 / 工具 / 工具组，以及过程里的中间叙述），展开时按原顺序还原 */
  rows: DisplayRow[];
  /** 组内已知耗时之和；全部缺时间戳（如历史回填）时为 undefined */
  durationMs?: number;
  thinkingCount: number;
  toolCount: number;
  errorCount: number;
}

export type DisplayRow = ConversationItem | ToolGroupItem | TurnProcessItem;

function makeGroup(tools: ToolItem[]): ToolGroupItem {
  let okCount = 0;
  let errorCount = 0;
  let runningCount = 0;
  let total = 0;
  let hasDuration = false;
  for (const t of tools) {
    if (t.status === "running") runningCount += 1;
    else if (t.status === "error") errorCount += 1;
    else okCount += 1;
    if (typeof t.durationMs === "number") {
      total += t.durationMs;
      hasDuration = true;
    }
  }
  const status: ToolGroupStatus = runningCount > 0 ? "running" : errorCount > 0 ? "has_error" : "all_ok";
  // 首个工具 id 作组键：同一连续段随流式追加时保持稳定，虚拟列表不因新工具重排闪烁。
  return {
    id: `tg:${tools[0].id}`,
    kind: "tool_group",
    tools,
    status,
    totalDurationMs: hasDuration ? total : undefined,
    okCount,
    errorCount,
    runningCount,
  };
}

export function groupToolRows(items: ConversationItem[], enabled: boolean): DisplayRow[] {
  if (!enabled) return items;
  const rows: DisplayRow[] = [];
  let run: ToolItem[] = [];
  const flush = (): void => {
    if (run.length >= 2) rows.push(makeGroup(run));
    else if (run.length === 1) rows.push(run[0]);
    run = [];
  };
  for (const item of items) {
    if (item.kind === "tool") {
      run.push(item);
    } else {
      flush();
      rows.push(item);
    }
  }
  flush();
  return rows;
}

export function isToolGroup(row: DisplayRow): row is ToolGroupItem {
  return row.kind === "tool_group";
}

export function isTurnProcess(row: DisplayRow): row is TurnProcessItem {
  return row.kind === "turn_process";
}

/** 聚合一组过程行的可观测摘要（耗时 / 思考数 / 工具数 / 失败数 / 是否仍有在跑）。 */
function sumProcess(rows: DisplayRow[]): {
  durationMs?: number;
  thinkingCount: number;
  toolCount: number;
  errorCount: number;
  running: boolean;
} {
  let total = 0;
  let hasDuration = false;
  let thinkingCount = 0;
  let toolCount = 0;
  let errorCount = 0;
  let running = false;
  const visit = (row: DisplayRow): void => {
    if (row.kind === "thinking") {
      thinkingCount += 1;
      if (typeof row.durationMs === "number") {
        total += row.durationMs;
        hasDuration = true;
      }
      return;
    }
    if (row.kind === "tool") {
      toolCount += 1;
      if (row.status === "running") running = true;
      else if (row.status === "error") errorCount += 1;
      if (typeof row.durationMs === "number") {
        total += row.durationMs;
        hasDuration = true;
      }
      return;
    }
    if (row.kind === "tool_group") {
      for (const tool of row.tools) visit(tool);
    }
  };
  for (const row of rows) visit(row);
  return { durationMs: hasDuration ? total : undefined, thinkingCount, toolCount, errorCount, running };
}

/**
 * 折叠单轮过程。返回原段（不折叠）的条件，凡有一条成立即原样返回：
 * - `inProgress`：该轮仍在流式中——过程要能边跑边看；
 * - 没有正文（找不到 assistant 行），或正文就是首行（它前面没有过程）；
 * - 组内仍有 running 工具；
 * - 过程里既无思考也无工具（只有中间叙述，折了等于把内容藏没）。
 */
function collapseSegment(seg: DisplayRow[], inProgress: boolean): DisplayRow[] {
  if (inProgress || seg.length === 0) return seg;
  let lastAssistant = -1;
  for (let i = seg.length - 1; i >= 0; i -= 1) {
    if (seg[i].kind === "assistant") {
      lastAssistant = i;
      break;
    }
  }
  if (lastAssistant <= 0) return seg;
  const process = seg.slice(0, lastAssistant);
  const head = process[0];
  if (!head) return seg;
  const stat = sumProcess(process);
  if (stat.running) return seg;
  if (stat.toolCount === 0 && stat.thinkingCount === 0) return seg;
  return [
    {
      id: `tp:${head.id}`,
      kind: "turn_process",
      rows: process,
      durationMs: stat.durationMs,
      thinkingCount: stat.thinkingCount,
      toolCount: stat.toolCount,
      errorCount: stat.errorCount,
    },
    ...seg.slice(lastAssistant),
  ];
}

/**
 * 轮次过程折叠（T10）：以 `user` 行为轮分隔（与缩略树、分叉的轮序口径一致），
 * 把**已结束**轮次的思考 / 工具过程收成一行，只留该轮正文在流上。
 *
 * `streaming` 只作用于最后一段（正在跑的那一轮）：其余段只要组内无 running 工具就折叠。
 */
export function collapseTurnProcess(rows: DisplayRow[], streaming: boolean): DisplayRow[] {
  const parts: DisplayRow[][] = [];
  let seg: DisplayRow[] = [];
  for (const row of rows) {
    if (row.kind === "user") {
      parts.push(seg);
      parts.push([row]);
      seg = [];
    } else {
      seg.push(row);
    }
  }
  parts.push(seg);

  const out: DisplayRow[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) continue;
    // 最后一段就是「当前这一轮」：流式中保持展开，结束（或加载历史）后才折叠
    out.push(...collapseSegment(part, i === parts.length - 1 && streaming));
  }
  return out;
}
