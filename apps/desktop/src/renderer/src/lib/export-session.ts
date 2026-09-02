import type { ConversationItem } from "../stores/session-store";

/** 长 tool 输出/入参截断阈值（字符），防止导出爆文件。 */
const MAX_TOOL_OUTPUT = 8000;
const MAX_TOOL_ARGS = 1000;

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}\n…[已截断，共 ${text.length} 字符]` : text;

/** 安全 JSON 序列化（循环引用等降级为 String）。 */
const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
};

/** 单个会话项 → Markdown 片段。 */
function itemToMarkdown(item: ConversationItem): string {
  switch (item.kind) {
    case "user":
      return `## 🧑 用户\n\n${item.text.trim()}`;
    case "assistant":
      return `## 🤖 助手\n\n${item.text.trim()}`;
    case "thinking": {
      const head = item.durationMs ? `思考（耗时 ${(item.durationMs / 1000).toFixed(1)}s）` : "思考";
      const body = item.text
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return `> ${head}\n${body}`;
    }
    case "tool": {
      const status = item.status === "ok" ? "✅" : item.status === "error" ? "❌" : "⏳";
      const lines: string[] = [`### 🔧 ${status} ${item.name}`];
      const argsText = safeJson(item.args);
      if (argsText && argsText !== "{}" && argsText !== "undefined") {
        lines.push("", "**入参**", "```json", truncate(argsText, MAX_TOOL_ARGS), "```");
      }
      if (item.diff) {
        lines.push("", "**Diff**", "```diff", truncate(item.diff, MAX_TOOL_OUTPUT), "```");
      }
      if (item.output) {
        lines.push("", "**输出**", "```", truncate(item.output, MAX_TOOL_OUTPUT), "```");
      }
      if (item.truncated) lines.push("", "> ⚠️ 工具输出已截断");
      if (item.fullOutputPath) lines.push("", `> 完整输出：\`${item.fullOutputPath}\``);
      return lines.join("\n");
    }
    case "system":
      return `---\n\n> _${item.text.trim()}_\n\n---`;
    default:
      return "";
  }
}

/**
 * 会话 → Markdown（T7.3）。子代理递归留 §7.7 T6.3 落地后补。
 */
export function formatSessionAsMarkdown(items: ConversationItem[], sessionTitle: string): string {
  const header = `# ${sessionTitle || "会话记录"}\n\n> 导出于 ${new Date().toISOString()} · 共 ${items.length} 条\n`;
  const body = items.map(itemToMarkdown).filter(Boolean).join("\n\n");
  return `${header}\n${body}\n`;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * 文件名安全化（T7.3）：NFKC 归一 + 小写 + 保留 Unicode 字母/数字（中文不转义）、
 * 其余折叠为 `-`、去首尾分隔符、截断 60、防 Windows 保留名、追加日期后缀。
 */
export function buildExportFilename(title: string, date = new Date()): string {
  let slug = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/[-.]+$/g, "");
  if (!slug || WINDOWS_RESERVED.test(slug)) slug = slug ? `pi-wood-${slug}` : "session";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${slug}-${y}-${m}-${d}.md`;
}
