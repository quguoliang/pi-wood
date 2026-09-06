import type { ConversationItem } from "../stores/session-store";
import type { DisplayRow, ToolGroupItem } from "./tool-groups";

/**
 * T9.1 上下文缩略树（v1 对话大纲）：把 groupToolRows 后的 DisplayRow[] 压成树栏节点。
 * 纯函数、无副作用、无 electron/DOM 依赖，可被 node --test 直接跑。
 *
 * 节点模型（§7.10 T9.1）：
 * - `user` 行 → 主节点（no=序号，title=首行截 48）；跳转锚点 = DisplayRow id（与虚拟列表行 id 同源）
 * - user 与下一 user 之间的 tool_group/tool 行 → 该主节点 children（默认折叠）；
 *   user 之前的散工具（罕见，历史回填边界）无处归属 → 丢弃
 * - `system` 行 → 独立标记节点（其后工具不归属，避免挂错轮次）
 * - assistant/thinking 行不进树（锚点太碎，导航价值低）
 * - streaming 时调用方追加 {kind:"live"} 伪节点
 */

export type OutlineToolStatus = "running" | "ok" | "error";

export interface OutlineToolNode {
  id: string;
  kind: "tool";
  title: string;
  status: OutlineToolStatus;
}

export interface OutlineNode {
  id: string;
  kind: "user" | "system";
  /** user 主节点序号（从 1 起）；system 节点无 */
  no?: number;
  title: string;
  tone?: "info" | "warn" | "error" | "success";
  children: OutlineToolNode[];
}

export interface OutlineLiveNode {
  id: "__live__";
  kind: "live";
}

export type OutlineEntry = OutlineNode | OutlineLiveNode;

export const LIVE_NODE_ID: "__live__" = "__live__";

const TITLE_MAX = 48;

function outlineTitle(text: string): string {
  const line = text
    .trim()
    .split("\n", 1)[0]
    ?.replace(/^#{1,6}\s+/, "") // 剥掉 Markdown 标题前缀（大纲里 # 是噪音）
    .replace(/\s+/g, " ")
    .trim();
  if (!line) return "(空消息)";
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
}

function groupStatusToOutline(status: ToolGroupItem["status"]): OutlineToolStatus {
  if (status === "running") return "running";
  if (status === "has_error") return "error";
  return "ok";
}

function toolStatusToOutline(status: "running" | "ok" | "error"): OutlineToolStatus {
  return status;
}

export function buildContextOutline(rows: DisplayRow[], opts?: { streaming?: boolean }): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  let cur: OutlineNode | null = null;
  for (const r of rows) {
    if (r.kind === "user") {
      cur = { id: r.id, kind: "user", no: out.filter((e) => e.kind === "user").length + 1, title: outlineTitle(r.text), children: [] };
      out.push(cur);
    } else if (r.kind === "tool_group" || r.kind === "tool") {
      if (!cur) continue; // 首个 user 之前的工具无处归属
      if (r.kind === "tool_group") {
        cur.children.push({ id: r.id, kind: "tool", title: `${r.tools[0]?.name ?? "工具"} ×${r.tools.length}`, status: groupStatusToOutline(r.status) });
      } else {
        cur.children.push({ id: r.id, kind: "tool", title: r.name, status: toolStatusToOutline(r.status) });
      }
    } else if (r.kind === "system") {
      cur = null;
      out.push({ id: r.id, kind: "system", title: outlineTitle(r.text), tone: r.tone, children: [] });
    }
    // assistant / thinking 不进树
  }
  if (opts?.streaming) out.push({ id: LIVE_NODE_ID, kind: "live" });
  return out;
}
