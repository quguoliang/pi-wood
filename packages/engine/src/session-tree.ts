/**
 * 会话 JSONL 树构建（纯函数，可单测）。
 * 条目结构 = Pi SessionEntryBase 实测口径：{ type, id, parentId: string|null, timestamp }。
 * 左栏 <SessionTree> 的数据源（T1.4）。
 */

export interface TreeEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  [key: string]: unknown;
}

export interface SessionTreeNode {
  id: string;
  parentId: string | null;
  type: string;
  timestamp: string;
  depth: number;
  children: SessionTreeNode[];
}

export interface SessionTree {
  nodes: Map<string, SessionTreeNode>;
  roots: SessionTreeNode[];
  /** 无子节点的节点 = 各分支末梢；活跃叶默认取时间戳最新者 */
  leafCandidates: SessionTreeNode[];
  /** 孤儿条目（parentId 指向不存在的节点），挂在 roots 下并标记，不丢数据 */
  orphans: SessionTreeNode[];
}

export function buildSessionTree(entries: TreeEntry[]): SessionTree {
  const nodes = new Map<string, SessionTreeNode>();
  for (const e of entries) {
    if (!e || typeof e.id !== "string" || e.id === "") continue;
    nodes.set(e.id, {
      id: e.id,
      parentId: typeof e.parentId === "string" ? e.parentId : null,
      type: e.type,
      timestamp: e.timestamp,
      depth: 0,
      children: [],
    });
  }

  const roots: SessionTreeNode[] = [];
  const orphans: SessionTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (!node.parentId) {
      roots.push(node);
    } else if (parent) {
      parent.children.push(node);
    } else {
      orphans.push(node);
    }
  }
  for (const list of [roots, orphans]) {
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  for (const node of nodes.values()) node.children.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const assignDepth = (node: SessionTreeNode, depth: number): void => {
    node.depth = depth;
    for (const child of node.children) assignDepth(child, depth + 1);
  };
  for (const root of roots) assignDepth(root, 0);

  const leafCandidates = [...nodes.values()].filter((n) => n.children.length === 0);
  leafCandidates.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return { nodes, roots, leafCandidates, orphans };
}

/** DFS 展平为虚拟列表行（带缩进深度）；activeId 路径上的节点标记 activeBranch */
export function flattenTree(
  tree: SessionTree,
  activeLeafId?: string,
): Array<SessionTreeNode & { activeBranch: boolean }> {
  const activePath = new Set<string>();
  if (activeLeafId) {
    let cur: SessionTreeNode | undefined = tree.nodes.get(activeLeafId);
    while (cur) {
      activePath.add(cur.id);
      cur = cur.parentId ? tree.nodes.get(cur.parentId) : undefined;
    }
  }
  const rows: Array<SessionTreeNode & { activeBranch: boolean }> = [];
  const visit = (node: SessionTreeNode): void => {
    rows.push({ ...node, activeBranch: activePath.has(node.id) });
    for (const child of node.children) visit(child);
  };
  for (const root of tree.roots) visit(root);
  for (const orphan of tree.orphans) visit(orphan);
  return rows;
}

/** 活跃叶：无 activeLeafId 时默认取时间戳最新的末梢 */
export function defaultLeaf(tree: SessionTree): SessionTreeNode | undefined {
  return tree.leafCandidates[tree.leafCandidates.length - 1];
}

/**
 * T9.2 上下文缩略树 v2：沿 parentId 链从 leaf 回溯到 root，返回 **root→leaf** 的条目 id 序列。
 * 用于「transcript 按分支路径过滤」（loadSessionMessages(file, leafId)）。
 * - append-only 树的父条目必在子条目之前落盘 ⇒ 文件序 = 任意链的 root→leaf 序，调用方可按原序取。
 * - `visited` 防环（parentId 数据异常时不死循环）。
 * - leafId 不在条目集内 → 返回 null（调用方按「不过滤」降级，绝不返回空路径把历史清没）。
 */
export function pathToLeafIds(entries: Array<Pick<TreeEntry, "id" | "parentId">>, leafId: string): string[] | null {
  const byId = new Map<string, Pick<TreeEntry, "id" | "parentId">>();
  for (const e of entries) if (typeof e?.id === "string" && e.id) byId.set(e.id, e);
  const cur = byId.get(leafId);
  if (!cur) return null;
  const ids: string[] = [];
  const visited = new Set<string>();
  let node: Pick<TreeEntry, "id" | "parentId"> | undefined = cur;
  while (node && !visited.has(node.id)) {
    visited.add(node.id);
    ids.push(node.id);
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  ids.reverse();
  return ids;
}
