import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

// T8.P 保留动态 import（非格式原因）：Pi SDK 已随 sdk-adapter 静态进入主进程启动图，
// 此处动态调用仅命中模块缓存，保留是为了维持本模块「按需取 SessionManager」的既有结构、零行为变更。
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

/**
 * T8.7 会话聚合的「有哪些树」：主项目 + `<proj>/.pi-wood/worktrees/*` 全部对话工作树。
 * Pi 的会话目录按 cwd 编码 ⇒ worktree 化会让会话分家，左栏必须按整个项目聚合（CLI 互通不回退）。
 */
export function worktreeTreesOf(projectDir: string): string[] {
  const wtRoot = join(projectDir, ".pi-wood", "worktrees");
  const dirs = [projectDir];
  if (existsSync(wtRoot)) {
    for (const entry of readdirSync(wtRoot)) dirs.push(join(wtRoot, entry));
  }
  return dirs;
}

/**
 * 跨树列举会话：同 id 只留一份（worktree 与主树可能是同一会话的副本），按 modified 新→旧。
 * `lister` 可注入——`--workspace-scope-probe` 用它断言聚合语义而不依赖 Pi 的会话目录编码规则。
 * 单棵树列举失败不影响其余（会话目录还没建出来的空树是常态）。
 */
export async function listSessionsAcrossTrees(
  projectDir: string,
  lister: (cwd: string) => Promise<SessionListItem[]> = listSessions,
): Promise<SessionListItem[]> {
  const trees = worktreeTreesOf(projectDir);
  const all = await Promise.all(trees.map((d) => lister(d).catch(() => [] as SessionListItem[])));
  const seen = new Set<string>();
  return all
    .flat()
    .filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    })
    .sort((a, b) => (a.modified < b.modified ? 1 : -1));
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
      // Pi 的 UserMessage.content 可为 string 或 (TextContent|ImageContent)[]；
      // 旧代码只认 string，数组内容（含附件）被丢弃 → 历史里用户消息消失。
      const content = msg.content;
      let text = "";
      if (typeof content === "string") text = content;
      else if (Array.isArray(content)) {
        text = content
          .map((part) =>
            part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
              ? (part as { text: string }).text
              : part && typeof part === "object" && (part as { type?: unknown }).type === "image"
                ? "[图片]"
                : "",
          )
          .filter(Boolean)
          .join("\n");
      }
      // 去掉主进程注入的附件块（<file ...>...</file>），与实时输入的干净气泡一致
      text = text.replace(/\n*<file\b[\s\S]*?<\/file>\n*/g, "").replace(/\n*<file\b[^>]*>\s*<\/file>\n*/g, "").trim();
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
