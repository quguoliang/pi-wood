/**
 * T7.9 会话辅助：纯逻辑（无 electron/网络副作用，可脱离运行时单测）。
 */
export interface AssistResult {
  recap: string;
  suggestions: string[];
}

const USER_CAP = 1500;
const ASSISTANT_CAP = 3000;
const MIN_ASSIST_TEXT = 40;

export const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 本轮助手正文是否值得生成辅助（过短跳过，省 token/耗时）。 */
export function shouldAssist(assistantText: string): boolean {
  return assistantText.trim().length >= MIN_ASSIST_TEXT;
}

export function buildAssistPrompt(userText: string, assistantText: string): string {
  return (
    "你是会话助手。基于下面一轮问答，产出简短回顾与追问建议。只输出一个 JSON 对象，" +
    '不要任何解释或代码块围栏。格式：{"recap":"≤80字中文回顾","suggestions":["追问1","追问2"]}，' +
    "suggestions 为 1~3 条、每条≤20字、用用户口吻、指向可继续的动作。\n\n" +
    `【用户问题】\n${truncate(userText, USER_CAP)}\n\n【助手回复】\n${truncate(assistantText, ASSISTANT_CAP)}`
  );
}

/** 从模型输出中提取并校验 JSON（剥代码围栏、取首个 {} 块）；无法解析或皆空 → null。 */
export function parseAssist(raw: string): AssistResult | null {
  if (!raw) return null;
  const text = raw.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as { recap?: unknown; suggestions?: unknown };
    const recap = typeof obj.recap === "string" ? obj.recap.trim() : "";
    const suggestions = Array.isArray(obj.suggestions)
      ? obj.suggestions
          .filter((s): s is string => typeof s === "string" && s.trim() !== "")
          .map((s) => s.trim())
          .slice(0, 3)
      : [];
    if (!recap && suggestions.length === 0) return null;
    return { recap, suggestions };
  } catch {
    return null;
  }
}
