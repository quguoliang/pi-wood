import { readFileSync } from "node:fs";
import {
  buildSessionTree,
  defaultLeaf,
  flattenTree,
  type SessionTreeNode,
  type TreeEntry,
} from "@pidesk/engine";

/**
 * 会话服务（T1.4 左栏 <HistoryPane>/<SessionTree> 数据层）。
 * 列表复用 Pi SessionManager.list（与 CLI 同源）；树解析 = Pi parseSessionEntries
 * + @pidesk/engine 的纯函数树构建。
 *
 * ⚠️ Pi 是 ESM-only 包：主进程内必须动态 import()，静态导入会导致
 * ERR_PACKAGE_PATH_NOT_EXPORTED（T1.4 实测，见执行计划 §8）。
 */

export interface SessionListItem {
  file: string;
  id: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
}

export interface SessionTreeRow {
  id: string;
  parentId: string | null;
  type: string;
  depth: number;
  activeBranch: boolean;
  timestamp: string;
}

export interface SessionTreeResult {
  sessionId?: string;
  totalEntries: number;
  rows: SessionTreeRow[];
  defaultLeafId?: string;
}

async function loadPi(): Promise<typeof import("@earendil-works/pi-coding-agent")> {
  return import("@earendil-works/pi-coding-agent");
}

export async function listSessions(cwd: string): Promise<SessionListItem[]> {
  const { SessionManager } = await loadPi();
  const infos = await SessionManager.list(cwd);
  return infos.map((s) => ({
    file: s.path,
    id: s.id,
    name: s.name,
    created: s.created.toISOString(),
    modified: s.modified.toISOString(),
    messageCount: s.messageCount,
    firstMessage: s.firstMessage.slice(0, 120),
  }));
}

export async function openSessionTree(file: string): Promise<SessionTreeResult> {
  const { parseSessionEntries } = await loadPi();
  const entries = parseSessionEntries(readFileSync(file, "utf-8")) as unknown as TreeEntry[];
  const tree = buildSessionTree(entries);
  const leaf = defaultLeaf(tree);
  const rows = flattenTree(tree, leaf?.id);
  return {
    sessionId: entries.find((e) => e.type === "session")?.id,
    totalEntries: entries.length,
    rows: rows.map((r) => ({
      id: r.id,
      parentId: r.parentId,
      type: r.type,
      depth: r.depth,
      activeBranch: r.activeBranch,
      timestamp: r.timestamp,
    })) satisfies SessionTreeRow[],
    defaultLeafId: leaf?.id,
  };
}

export type { SessionTreeNode };
