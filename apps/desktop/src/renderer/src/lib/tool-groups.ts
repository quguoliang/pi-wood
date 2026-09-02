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

export type DisplayRow = ConversationItem | ToolGroupItem;

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
