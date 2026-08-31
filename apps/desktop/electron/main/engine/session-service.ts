import { readFileSync } from "node:fs";
import {
  buildSessionTree,
  defaultLeaf,
  flattenTree,
  type SessionTreeNode,
  type TreeEntry,
} from "@pi-wood/engine";

/**
 * 会话服务（T1.4 左栏 <HistoryPane>/<SessionTree> 数据层）。
 * 列表复用 Pi SessionManager.list（与 CLI 同源）；树解析 = Pi parseSessionEntries
 * + @pi-wood/engine 的纯函数树构建。
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

export interface SessionMessageItem {
  role: "user" | "assistant" | "tool";
  text: string;
  toolCallId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  isError?: boolean;
}

/** 读取会话历史消息（点击会话续写时加载到 UI），保留 assistant 的 toolCall 与 toolResult 配对 */
export async function loadSessionMessages(file: string): Promise<SessionMessageItem[]> {
  const { SessionManager } = await loadPi();
  const manager = SessionManager.open(file);
  const out: SessionMessageItem[] = [];
  const pendingCalls = new Map<string, { name: string; input?: Record<string, unknown> }>();

  const flushText = (role: "user" | "assistant", text: string): void => {
    if (text.trim()) out.push({ role, text });
  };

  for (const entry of manager.getEntries()) {
    if (entry.type !== "message") continue;
    const msg = (entry as { message?: unknown }).message as Record<string, unknown> | undefined;
    if (!msg || typeof msg.role !== "string") continue;
    const role = msg.role;

    if (role === "user") {
      const text = typeof msg.content === "string" ? msg.content : "";
      flushText("user", text);
      continue;
    }

    if (role === "assistant") {
      const content = msg.content;
      if (typeof content === "string") {
        flushText("assistant", content);
        continue;
      }
      if (!Array.isArray(content)) continue;
      let textBuf = "";
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const p = part as { type?: string; text?: string; id?: string; name?: string; arguments?: unknown };
        if (p.type === "text") {
          textBuf += p.text ?? "";
        } else if (p.type === "toolCall") {
          flushText("assistant", textBuf);
          textBuf = "";
          const callId = typeof p.id === "string" ? p.id : `hist-${out.length}`;
          const toolName = String(p.name ?? "unknown");
          const input =
            p.arguments !== null && typeof p.arguments === "object" && !Array.isArray(p.arguments)
              ? (p.arguments as Record<string, unknown>)
              : undefined;
          pendingCalls.set(callId, { name: toolName, input });
          out.push({
            role: "tool",
            text: "",
            toolCallId: callId,
            toolName,
            toolInput: input,
            isError: false,
          });
        }
      }
      flushText("assistant", textBuf);
      continue;
    }

    if (role === "toolResult") {
      const callId = typeof msg.toolCallId === "string" ? msg.toolCallId : "";
      const content = msg.content;
      let text = "";
      if (typeof content === "string") text = content;
      else if (Array.isArray(content)) {
        text = content
          .map((c) =>
            c !== null && typeof c === "object" && typeof (c as { text?: unknown }).text === "string"
              ? (c as { text: string }).text
              : "",
          )
          .filter(Boolean)
          .join("\n");
      }
      const isError = Boolean(msg.isError);
      const existing = callId ? out.findIndex((m) => m.role === "tool" && m.toolCallId === callId) : -1;
      if (existing >= 0) {
        out[existing] = { ...out[existing], text, isError };
      } else {
        const known = pendingCalls.get(callId);
        out.push({
          role: "tool",
          text,
          toolCallId: callId || `hist-${out.length}`,
          toolName: known?.name ?? String(msg.toolName ?? "tool"),
          toolInput: known?.input,
          isError,
        });
      }
    }
  }
  return out;
}
