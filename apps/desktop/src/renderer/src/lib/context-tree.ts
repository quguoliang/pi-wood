/**
 * T9.2 上下文缩略树 v2：从 Pi 会话树（append-only，entry id/parentId）派生「真分支」视图。
 * 纯函数、零依赖、可被 node --test 直接跑；输入 = `sessions:tree` 的行投影
 * （@pi-wood/ipc-schema SessionTreeRowSchema + T9.2 的 role/textHead 字段）。
 *
 * 语义（对齐 SDK navigateTree）：
 * - **路径**：从 activeLeafId 沿 parentId 回溯到 root；路径外的条目 = 旁支（被放弃/并行的分支）。
 * - **旁支根**（branch root）= 「自己不在路径上」且「父在路径上 / 父缺失（孤儿、多根）」的条目——
 *   每个旁支只在此处出现一次，其子树整体折叠成一行。
 * - 挂载点 attachOrdinal = 分叉点之前（含）已有多少条路径 user 条目；0 = 挂在第一条用户消息之前。
 * - **切换目标**：双击旁支 → navigateTree(entryId)。目标是 user 条目时 SDK 把 leaf 挪到其**父**
 *   并回填原文（「改这问重发」）；否则 leaf = 条目本身（「从这条回复继续聊」）。
 *
 * v1 的 DisplayRow 大纲（context-outline.ts）仍然是路径节点的行内导航与跳转底座，
 * 本文件只补「旁支可见 + 可切换」这一层；两者用同一套 user 序号对齐。
 */

/** T9.2 v2.1：中栏容器宽度低于此值时缩略树自动收起（§7.10 显隐规则 4） */
export const CONTEXT_TREE_MIN_CENTER_WIDTH = 720;

/** 与 ipc-schema SessionTreeRowSchema 对齐的结构类型（渲染层不 import zod，保持纯） */
export interface TreeRowLike {
  id: string;
  parentId: string | null;
  type: string;
  depth: number;
  activeBranch: boolean;
  timestamp: string;
  role?: "user" | "assistant" | "tool" | "other";
  textHead?: string;
}

/** 一条旁支（折叠后的分支子树） */
export interface BranchNode {
  /** 旁支最顶端的非路径条目 id = navigateTree 的候选目标 */
  rootId: string;
  kind: NonNullable<TreeRowLike["role"]>;
  title: string;
  timestamp: string;
  /** 子树里的 user 条目数（含 rootId 自身） */
  userCount: number;
  /** 子树条目总数（展开预览前的规模提示） */
  totalEntries: number;
  /** 挂在路径上第几条 user 节点之下（0 = 全部 user 节点之前） */
  attachOrdinal: number;
}

/** 展开旁支时列出的分支内用户节点 */
export interface BranchLeafNode {
  entryId: string;
  title: string;
  timestamp: string;
  /** rootId 到该条目的距离（缩进提示用） */
  hops: number;
}

export interface ContextTreeV2 {
  leafId: string | undefined;
  /** 路径上全部条目 id（root→leaf 序） */
  pathIds: string[];
  /** 路径上的 user 条目 id（同序；与 DisplayRow 的 user 行按序号 1:1 对齐） */
  pathUserEntryIds: string[];
  /** 旁支列表（按挂载点序号、时间戳排序） */
  branches: BranchNode[];
  /** 叶子数 >1 ⇒ 这份会话真分叉过（线性会话不误报） */
  forked: boolean;
}

const EMPTY: ContextTreeV2 = { leafId: undefined, pathIds: [], pathUserEntryIds: [], branches: [], forked: false };

const TITLE_MAX = 48;

export function branchTitle(row: TreeRowLike): string {
  const line = (row.textHead ?? "").trim().split("\n", 1)[0]?.trim() ?? "";
  if (line) return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
  // 无题面的条目（纯工具轮/系统条目）按角色给占位
  return row.role === "assistant" ? "（回复）" : row.role === "tool" ? "（工具）" : row.role === "user" ? "(空消息)" : "（节点）";
}

function indexRows(rows: TreeRowLike[]): { byId: Map<string, TreeRowLike>; childrenOf: Map<string, TreeRowLike[]> } {
  const byId = new Map<string, TreeRowLike>();
  for (const r of rows) if (r && typeof r.id === "string" && r.id) byId.set(r.id, r);
  const childrenOf = new Map<string, TreeRowLike[]>();
  for (const r of byId.values()) {
    if (!r.parentId || !byId.has(r.parentId)) continue;
    const list = childrenOf.get(r.parentId);
    if (list) list.push(r);
    else childrenOf.set(r.parentId, [r]);
  }
  return { byId, childrenOf };
}

/** leafId 缺席时的默认叶：时间戳最新的末梢（与主进程 defaultLeaf 同一启发） */
export function defaultLeafId(rows: TreeRowLike[]): string | undefined {
  const { byId, childrenOf } = indexRows(rows);
  let best: string | undefined;
  let bestTs = "";
  for (const r of byId.values()) {
    if ((childrenOf.get(r.id)?.length ?? 0) > 0) continue; // 非末梢
    if (best === undefined || r.timestamp >= bestTs) {
      best = r.id;
      bestTs = r.timestamp;
    }
  }
  return best;
}

/**
 * 派生 v2 视图。rows 允许乱序/孤儿（防御式建树，与主进程 buildSessionTree 同口径）。
 */
export function deriveContextTree(rows: TreeRowLike[], activeLeafId?: string): ContextTreeV2 {
  if (!rows.length) return EMPTY;
  const { byId, childrenOf } = indexRows(rows);
  const leafId = activeLeafId && byId.has(activeLeafId) ? activeLeafId : defaultLeafId(rows);
  if (!leafId) return { ...EMPTY, leafId: undefined };

  // 1) 路径回溯（visited 防环）
  const pathIds: string[] = [];
  const pathSet = new Set<string>();
  const seen = new Set<string>();
  let cur: TreeRowLike | undefined = byId.get(leafId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    pathIds.push(cur.id);
    pathSet.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  pathIds.reverse();
  const pathUserEntryIds = pathIds.filter((id) => byId.get(id)?.role === "user");

  // 2) 路径前缀 user 计数（挂载点序号 O(1) 查）
  const prefixUsers: number[] = [];
  let acc = 0;
  for (const id of pathIds) {
    if (byId.get(id)?.role === "user") acc += 1;
    prefixUsers.push(acc);
  }
  const pathIndex = new Map<string, number>();
  pathIds.forEach((id, i) => pathIndex.set(id, i));
  const ordinalAt = (pathId: string): number => prefixUsers[pathIndex.get(pathId) ?? 0] ?? 0;

  // 3) 旁支根 = 「自己不在路径上」且「父为空 / 父不存在（孤儿、多根）/ 父在路径上」；
  //    其余路径外条目都被某个 root 的子树聚合覆盖，不重复出现。
  const branches: BranchNode[] = [];
  for (const r of byId.values()) {
    if (pathSet.has(r.id)) continue;
    const parentMissing = !r.parentId || !byId.has(r.parentId);
    const parentOnPath = Boolean(r.parentId && pathSet.has(r.parentId));
    if (!parentMissing && !parentOnPath) continue;
    const stats = measureSubtree(r.id, byId, childrenOf);
    // 无 user 且不从 assistant 起头的旁支（纯工具/系统碎枝）没有「回到这里」的价值，隐藏
    if (stats.userCount === 0 && stats.kind !== "assistant") continue;
    branches.push({
      rootId: r.id,
      kind: stats.kind,
      title: stats.title,
      timestamp: r.timestamp,
      userCount: stats.userCount,
      totalEntries: stats.total,
      attachOrdinal: parentOnPath ? ordinalAt(r.parentId as string) : 0,
    });
  }

  branches.sort((a, b) => a.attachOrdinal - b.attachOrdinal || a.timestamp.localeCompare(b.timestamp));

  // 4) forked：叶子数 >1 ⇒ 真有过分支
  let leaves = 0;
  for (const id of byId.keys()) if (!childrenOf.get(id)?.length) leaves += 1;

  return { leafId, pathIds, pathUserEntryIds, branches, forked: leaves > 1 };
}

function measureSubtree(
  rootId: string,
  byId: Map<string, TreeRowLike>,
  childrenOf: Map<string, TreeRowLike[]>,
): { userCount: number; total: number; kind: BranchNode["kind"]; title: string } {
  let userCount = 0;
  let total = 0;
  const visited = new Set<string>();
  const stack: string[] = [rootId];
  while (stack.length) {
    const id = stack.pop() as string;
    if (visited.has(id)) continue;
    visited.add(id);
    total += 1;
    const row = byId.get(id);
    if (row?.role === "user") userCount += 1;
    for (const c of childrenOf.get(id) ?? []) stack.push(c.id);
  }
  const root = byId.get(rootId);
  return {
    userCount,
    total,
    kind: root?.role ?? "other",
    title: root ? branchTitle(root) : "（分支）",
  };
}

/**
 * 展开一条旁支：按 DFS 序返回子树里的 user 条目（可各自切换）。limit 防大会话展开炸渲染。
 */
export function expandBranch(rows: TreeRowLike[], rootId: string, limit = 12): BranchLeafNode[] {
  const { byId, childrenOf } = indexRows(rows);
  const out: BranchLeafNode[] = [];
  const visited = new Set<string>();
  const walk = (id: string, hops: number): void => {
    if (out.length >= limit || visited.has(id)) return;
    visited.add(id);
    const row = byId.get(id);
    if (row?.role === "user") out.push({ entryId: id, title: branchTitle(row), timestamp: row.timestamp, hops });
    const kids = [...(childrenOf.get(id) ?? [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    for (const k of kids) walk(k.id, hops + 1);
  };
  walk(rootId, 0);
  return out;
}

/**
 * 旁支子树的「梢」= 子树内无子节点且时间戳最新的条目。
 * T9.2 v2.1「把这条分支另开新对话」用：createBranchedSession(tip) 得到 root→tip 的完整分支路径。
 */
export function branchTipId(rows: TreeRowLike[], rootId: string): string | null {
  const { byId, childrenOf } = indexRows(rows);
  if (!byId.has(rootId)) return null;
  let tip: string | null = null;
  let tipTs = "";
  const visited = new Set<string>();
  const stack: string[] = [rootId];
  while (stack.length) {
    const id = stack.pop() as string;
    if (visited.has(id)) continue;
    visited.add(id);
    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) {
      const row = byId.get(id);
      if (row && (tip === null || row.timestamp >= tipTs)) {
        tip = id;
        tipTs = row.timestamp;
      }
    }
    for (const k of kids) stack.push(k.id);
  }
  return tip;
}

/**
 * navigateTree 目标的落点换算（与 SDK 行为一致，渲染层据此预先摆好 activeLeaf）：
 * user 条目 → leaf = 其父（SDK 回填原文到输入框）；其余 → leaf = 条目本身。
 * 返回 null = 数据里找不到该条目（调用方拒绝切换）。
 */
export function navigateLandsOn(rows: TreeRowLike[], targetId: string): { leafId: string | null; prefill: boolean } | null {
  const { byId } = indexRows(rows);
  const row = byId.get(targetId);
  if (!row) return null;
  if (row.role === "user") return { leafId: row.parentId, prefill: true };
  return { leafId: targetId, prefill: false };
}
