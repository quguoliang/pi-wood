/**
 * T7.10 Agent Memory —— 纯存储/裁剪逻辑（无 fs / 无 electron，可单测）。
 *
 * 条目落两处文件：global（跨项目）与 project（当前项目）。scope 由「当前项目目录」推导，
 * agent 只能选 global|project、**不能指定 project id**（防跨项目污染）。agent 保存的记忆一律
 * reviewed:false（unreviewed 安全模式），用户确认后才 reviewed:true。
 */

export type MemoryType = "fact" | "preference" | "reference";
export type MemoryScope = "global" | "project";

export interface MemoryItem {
  id: string;
  type: MemoryType;
  title: string;
  body: string;
  scope: MemoryScope;
  createdAt: number;
  reviewed: boolean;
}

export interface NewMemoryInput {
  type?: unknown;
  title?: unknown;
  body?: unknown;
  scope?: unknown;
}

const TYPES = new Set<MemoryType>(["fact", "preference", "reference"]);
const SCOPES = new Set<MemoryScope>(["global", "project"]);
const TITLE_MAX = 200;
const BODY_MAX = 2000;

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** 解析存储 JSON（数组）；缺失/坏 JSON/非数组 → []，逐项丢弃非法。 */
export function parseItems(raw: string | null | undefined): MemoryItem[] {
  if (!raw || !raw.trim()) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: MemoryItem[] = [];
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.title !== "string" || typeof o.body !== "string") continue;
    out.push({
      id: o.id,
      type: TYPES.has(o.type as MemoryType) ? (o.type as MemoryType) : "fact",
      title: o.title,
      body: o.body,
      scope: SCOPES.has(o.scope as MemoryScope) ? (o.scope as MemoryScope) : "global",
      createdAt: typeof o.createdAt === "number" ? o.createdAt : 0,
      reviewed: o.reviewed === true,
    });
  }
  return out;
}

export function serializeItems(items: readonly MemoryItem[]): string {
  return JSON.stringify(items, null, 2);
}

/** 生成条目 id（服务层用；测试可注入固定 id 保证确定性）。 */
export function genId(now: number): string {
  return `mem-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface AddResult {
  items: MemoryItem[];
  item: MemoryItem | null;
  created: boolean; // true=新增，false=按 title 命中更新
  error?: string;
}

/**
 * 新增或（同 scope + 同标题，大小写不敏感）更新一条记忆。内容变更会把 reviewed 重置为 false
 * （新内容视为未经确认）。title/body 缺一即拒。scope 非法按 global。
 */
export function addItem(
  items: readonly MemoryItem[],
  input: NewMemoryInput,
  opts: { id?: string; now?: number } = {},
): AddResult {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!title || !body) return { items: [...items], item: null, created: false, error: "title 与 body 均必填" };
  const type: MemoryType = TYPES.has(input.type as MemoryType) ? (input.type as MemoryType) : "fact";
  const scope: MemoryScope = SCOPES.has(input.scope as MemoryScope) ? (input.scope as MemoryScope) : "global";
  const now = opts.now ?? Date.now();
  const key = `${scope}::${title.toLowerCase()}`;
  const next = items.map((m) => ({ ...m }));
  const idx = next.findIndex((m) => `${m.scope}::${m.title.toLowerCase()}` === key);
  if (idx >= 0) {
    const prev = next[idx]!;
    const changed = prev.body !== body || prev.type !== type;
    const updated: MemoryItem = { ...prev, type, body: clip(body, BODY_MAX), reviewed: changed ? false : prev.reviewed };
    next[idx] = updated;
    return { items: next, item: updated, created: false };
  }
  const item: MemoryItem = {
    id: opts.id ?? genId(now),
    type,
    title: clip(title, TITLE_MAX),
    body: clip(body, BODY_MAX),
    scope,
    createdAt: now,
    reviewed: false,
  };
  next.push(item);
  return { items: next, item, created: true };
}

export function deleteById(items: readonly MemoryItem[], id: string): { items: MemoryItem[]; removed: boolean } {
  const next = items.filter((m) => m.id !== id);
  return { items: next.map((m) => ({ ...m })), removed: next.length !== items.length };
}

export function setReviewed(
  items: readonly MemoryItem[],
  id: string,
  reviewed: boolean,
): { items: MemoryItem[]; changed: boolean } {
  let changed = false;
  const next = items.map((m) => {
    if (m.id !== id) return { ...m };
    if (m.reviewed === reviewed) return { ...m };
    changed = true;
    return { ...m, reviewed };
  });
  return { items: next, changed };
}

export function updateItem(
  items: readonly MemoryItem[],
  id: string,
  patch: { title?: unknown; body?: unknown; type?: unknown },
): AddResult {
  const idx = items.findIndex((m) => m.id === id);
  if (idx < 0) return { items: [...items], item: null, created: false, error: "未找到该记忆" };
  const cur = items[idx]!;
  const title = patch.title !== undefined ? String(patch.title).trim() : cur.title;
  const body = patch.body !== undefined ? String(patch.body).trim() : cur.body;
  if (!title || !body) return { items: [...items], item: null, created: false, error: "title 与 body 均不能为空" };
  const type: MemoryType = TYPES.has(patch.type as MemoryType) ? (patch.type as MemoryType) : cur.type;
  const next = items.map((m) => ({ ...m }));
  const changedContent = body !== cur.body || type !== cur.type || title !== cur.title;
  const updated: MemoryItem = {
    ...cur,
    title: clip(title, TITLE_MAX),
    body: clip(body, BODY_MAX),
    type,
    reviewed: changedContent ? false : cur.reviewed,
  };
  next[idx] = updated;
  return { items: next, item: updated, created: false };
}

/** 给 agent 的记忆清单文本：分 global / project 两段，标注 reviewed 状态。 */
export function renderForAgent(globalItems: readonly MemoryItem[], projectItems: readonly MemoryItem[]): string {
  const lines: string[] = [];
  const section = (label: string, items: readonly MemoryItem[]): void => {
    lines.push(`【${label}】`);
    if (items.length === 0) {
      lines.push("  （无）");
      return;
    }
    for (const m of items) {
      lines.push(`  - [${m.id}] (${m.type}${m.reviewed ? "" : ", 未确认—谨慎参考"}) ${m.title}：${m.body}`);
    }
  };
  section("全局记忆", globalItems);
  section("本项目记忆", projectItems);
  lines.push("", "用 memory.read(id) 看全文，memory.save 新增/更新，memory.delete 删除。标注「未确认」的条目用户尚未审阅。");
  return lines.join("\n");
}
