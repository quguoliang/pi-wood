/**
 * T7.7 代码审查：prompt 构造 + 模型输出解析（纯函数、无 electron 依赖、可单测）。
 * 要求模型只输出一个 JSON 数组；解析时宽松提取首个 `[...]`，逐项规整、丢弃非法项。
 */
import type { Finding, ReviewSeverity } from "@pi-wood/ipc-schema";

/** 送给审查模型的 diff 上限（超大 diff 截断，避免爆上下文）。 */
export const MAX_DIFF_CHARS = 60_000;

/** 无变更判定：git diff 文本去掉空白后为空。 */
export function hasChanges(diff: string): boolean {
  return diff.trim().length > 0;
}

export function buildReviewPrompt(diff: string): string {
  const clipped = diff.length > MAX_DIFF_CHARS ? `${diff.slice(0, MAX_DIFF_CHARS)}\n… (diff 过大已截断)` : diff;
  return [
    "你是严格的资深代码审查者。审查下面这份 unified diff（git diff HEAD），只报告**确有把握**的问题：",
    "明显 bug、边界/空值/错误处理缺失、安全问题、并发/资源泄漏、会破坏行为的改动。",
    "不要风格吹毛求疵、不要臆测未在 diff 中出现的问题。没有实质问题就返回空数组 []。",
    "",
    "只输出一个 JSON 数组，不要任何额外文字或代码围栏之外内容。每个元素：",
    `{"file":"相对路径","line":整数或省略,"severity":"error"|"warning"|"info","message":"≤120字问题","suggestion":"≤120字修复建议，可省略"}`,
    "",
    "diff：",
    "```",
    clipped,
    "```",
  ].join("\n");
}

const SEV: ReviewSeverity[] = ["error", "warning", "info"];

function asFinding(raw: unknown): Finding | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const file = typeof o.file === "string" ? o.file.trim() : "";
  const message = typeof o.message === "string" ? o.message.trim() : "";
  if (!file || !message) return null;
  const severity: ReviewSeverity = SEV.includes(o.severity as ReviewSeverity) ? (o.severity as ReviewSeverity) : "info";
  let line: number | undefined;
  if (typeof o.line === "number" && Number.isFinite(o.line) && o.line >= 0) line = Math.floor(o.line);
  const suggestion = typeof o.suggestion === "string" && o.suggestion.trim() ? o.suggestion.trim().slice(0, 400) : undefined;
  return { file: file.slice(0, 400), line, severity, message: message.slice(0, 400), suggestion };
}

/** 提取模型文本里的首个 JSON 数组 → 规整后的发现列表；解析不出数组 → []。 */
export function parseFindings(raw: string): Finding[] {
  if (!raw) return [];
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: Finding[] = [];
  for (const item of arr) {
    const f = asFinding(item);
    if (f) out.push(f);
  }
  return out.slice(0, 100); // 防御性上限
}
