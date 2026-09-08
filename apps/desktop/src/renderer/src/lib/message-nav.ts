import type { ConversationItem } from "../stores/session-store";

/**
 * T9.2 v2.2 消息刻度导航（MessageNav）纯逻辑：完全对齐 OpenWood 参考实现
 * （opencode session-ui `message-nav.tsx` + `diff-changes.tsx` variant="bars"）。
 *
 * 参考形态要点：
 * - 刻度只按 **user 轮次** 生成（`messages: UserMessage[]`），assistant/thinking/tool/system 不成刻度；
 * - 条目摘要 = 该条文本首个非空行（参考 `getLabel`：text part 首行 trim）；
 * - 每个轮次带一组增删计数（参考 `message.summary.diffs`），渲染成 5 根 bars；
 *   pi-wood 侧的数据源 = 该轮内所有 tool 行的 `diffStat` 汇总。
 *
 * 纯函数、无 DOM、无 electron 依赖，可被 node --test 直接跑。
 */

export interface NavTick {
  /** MessageList 行 id（跳转锚点，与虚拟列表 key 同源） */
  rowId: string;
  /** 首行摘要（空消息回落到调用方占位文案） */
  title: string;
  /** user 轮次序号，从 0 起 */
  turnIndex: number;
  /** 该轮累计新增行数（bars 色块分配用） */
  additions: number;
  /** 该轮累计删除行数 */
  deletions: number;
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
 * 由对话条目序列派生刻度：每个 user 一条，其后（下一条 user 之前）的 tool diffStat 归属该轮。
 * 首条 user 之前的散工具（历史回填边界，罕见）无处归属 → 忽略。
 */
export function buildNavTicks(items: readonly ConversationItem[]): NavTick[] {
  const out: NavTick[] = [];
  for (const it of items) {
    if (it.kind === "user") {
      out.push({ rowId: it.id, title: firstLine(it.text), turnIndex: out.length, additions: 0, deletions: 0 });
    } else if (it.kind === "tool" && it.diffStat) {
      const tick = out.at(-1);
      if (tick) {
        tick.additions += it.diffStat.added;
        tick.deletions += it.diffStat.deleted;
      }
    }
  }
  return out;
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

/** bars 总块数（参考 `TOTAL_BLOCKS`）。 */
export const DIFF_TOTAL_BLOCKS = 5;

/**
 * 增删行数 → [绿块数, 红块数, 灰块数]。逐条搬运参考实现 `DiffChanges.blockCounts` 的分档规则：
 * 极小改动各占 1 块；<20 或比例 <4 时只用 4 块上色；≤5/≤10 行封顶 1/2 块；超额按主导方回退。
 */
export function diffBarCounts(additions: number, deletions: number): [number, number, number] {
  const adds = Math.max(0, additions || 0);
  const dels = Math.max(0, deletions || 0);
  if (adds === 0 && dels === 0) return [0, 0, DIFF_TOTAL_BLOCKS];

  const total = adds + dels;
  if (total < 5) {
    const added = adds > 0 ? 1 : 0;
    const deleted = dels > 0 ? 1 : 0;
    return [added, deleted, DIFF_TOTAL_BLOCKS - added - deleted];
  }

  const ratio = adds > dels ? adds / dels : dels / adds;
  let blocksForColors = DIFF_TOTAL_BLOCKS;
  if (total < 20) blocksForColors = DIFF_TOTAL_BLOCKS - 1;
  else if (ratio < 4) blocksForColors = DIFF_TOTAL_BLOCKS - 1;

  const addedRaw = (adds / total) * blocksForColors;
  const deletedRaw = (dels / total) * blocksForColors;
  let added = adds > 0 ? Math.max(1, Math.round(addedRaw)) : 0;
  let deleted = dels > 0 ? Math.max(1, Math.round(deletedRaw)) : 0;

  if (adds > 0 && adds <= 5) added = Math.min(added, 1);
  if (adds > 5 && adds <= 10) added = Math.min(added, 2);
  if (dels > 0 && dels <= 5) deleted = Math.min(deleted, 1);
  if (dels > 5 && dels <= 10) deleted = Math.min(deleted, 2);

  if (added + deleted > blocksForColors) {
    if (addedRaw > deletedRaw) added = blocksForColors - deleted;
    else deleted = blocksForColors - added;
  }
  const neutral = Math.max(0, DIFF_TOTAL_BLOCKS - (added + deleted));
  return [Math.max(0, added), Math.max(0, deleted), neutral];
}
