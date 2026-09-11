import type { ConversationItem } from "../stores/session-store";

/**
 * T9.2 v2.2 消息刻度导航（MessageNav）纯逻辑：形态对齐 OpenWood 参考实现
 * （opencode session-ui `message-nav.tsx`；其 diff-changes bars 已按用户裁决移除）。
 *
 * 要点：
 * - 刻度按 **user 轮次 + agent 正文回复** 生成（2026-09-11 用户裁决：回复也要能导航），
 *   thinking/tool/system 不成刻度（工具细节走工具卡、思考可折叠）；
 * - 条目摘要 = 该条文本首个非空行（参考 `getLabel`：text part 首行 trim）；
 *   agent 回复很长，只取正文一部分、超长省略号截断（firstLine 的 TITLE_MAX_CHARS）。
 *
 * 纯函数、无 DOM、无 electron 依赖，可被 node --test 直接跑。
 */

export interface NavTick {
  /** MessageList 行 id（跳转锚点，与虚拟列表 key 同源） */
  rowId: string;
  /** 首行摘要（空消息回落到调用方占位文案） */
  title: string;
  /** 刻度种类：user=提问（长刻度）；assistant=agent 回复（短刻度） */
  kind: "user" | "assistant";
  /** 刻度序号，从 0 起 */
  turnIndex: number;
}

/** 标题最大展示字符数，超出截断加省略号。 */
export const TITLE_MAX_CHARS = 60;

/** 取文本首行作为条目摘要：去 markdown 装饰、压空白、超长截断。空行回退 ''（调用方给占位文案）。 */
export function firstLine(text: string): string {
  const line =
    text
      .trim()
      .split("\n", 1)[0]
      ?.replace(/^#{1,6}\s+/, "")
      .replace(/[*`>]+/g, "")
      .replace(/\s+/g, " ")
      .trim() ?? "";
  return line.length > TITLE_MAX_CHARS ? `${line.slice(0, TITLE_MAX_CHARS - 1)}…` : line;
}

/**
 * 由对话条目序列派生刻度：user 与 assistant 各成一条，保持对话顺序。
 */
export function buildNavTicks(items: readonly ConversationItem[]): NavTick[] {
  return items
    .filter((it): it is ConversationItem & { kind: "user" | "assistant" } => it.kind === "user" || it.kind === "assistant")
    .map((it) => ({ rowId: it.id, title: firstLine(it.text), kind: it.kind, turnIndex: 0 }))
    .map((t, i) => ({ ...t, turnIndex: i }));
}

/**
 * hover 时的刻度宽度（正态分布衰减）：目标刻度 = maxWidth，邻居按高斯衰减向 baseWidth 收拢，
 * 远端等于 baseWidth；hover 为空（常态）时**所有刻度一律 baseWidth**——不做默认高亮。
 */
export function tickWidthAt(
  index: number,
  hoveredIndex: number,
  baseWidth: number,
  maxWidth: number,
  sigma: number,
): number {
  if (hoveredIndex < 0) return baseWidth;
  const d = index - hoveredIndex;
  return baseWidth + (maxWidth - baseWidth) * Math.exp(-(d * d) / (2 * sigma * sigma));
}
