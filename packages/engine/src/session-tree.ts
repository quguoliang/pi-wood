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
