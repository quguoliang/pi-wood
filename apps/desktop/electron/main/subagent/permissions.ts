/**
 * T6.7 子代理 per-tool 权限的纯逻辑（无 electron/fs 依赖，可单测）。
 * 权限覆盖存于 pi-wood settings.subagentPermissions（agent → tool → allow|ask|deny），
 * 这里只做映射的增删、agent 目录名→profile、frontmatter description 提取、列表合并。
 */
import type { SubagentProfileInfo, ToolPermissionAction } from "@pi-wood/ipc-schema";

export type PermMap = Record<string, Record<string, ToolPermissionAction>>;
export type PermAction = ToolPermissionAction | "inherit";

/** `explore.md` → `explore`（文件名即 agent 名，与 vendored profile 约定一致）。 */
export function profileNameFromFile(file: string): string {
  return file.replace(/\.(md|markdown)$/i, "");
}

/** 从 markdown YAML frontmatter 提取单行 description（去引号）；无则 undefined。 */
export function extractDescription(content: string): string | undefined {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!fm) return undefined;
  const m = /^description:\s*(.*)$/m.exec(fm[1] ?? "");
  if (!m) return undefined;
  let v = (m[1] ?? "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v || undefined;
}

/** 设置/清除（inherit）某 agent 某工具的覆盖；返回新映射（不可变）。清空则删该 agent 条目。 */
export function setToolPermission(
  map: PermMap,
  agent: string,
  tool: string,
  action: PermAction,
): PermMap {
  const next: PermMap = { ...map };
  const cur: Record<string, ToolPermissionAction> = { ...(next[agent] ?? {}) };
  if (action === "inherit") delete cur[tool];
  else cur[tool] = action;
  if (Object.keys(cur).length > 0) next[agent] = cur;
  else delete next[agent];
  return next;
}

/** 清除某 agent 的全部覆盖（整体回退继承）。 */
export function clearAgentPermissions(map: PermMap, agent: string): PermMap {
  const next = { ...map };
  delete next[agent];
  return next;
}

/** 有效 profile（agents 目录扫到）∪ 已配置（settings 残留）合并为展示列表，按名排序。 */
export function buildProfiles(
  scanned: ReadonlyArray<{ name: string; description?: string }>,
  configured: PermMap,
): SubagentProfileInfo[] {
  const byName = new Map<string, SubagentProfileInfo>();
  for (const s of scanned) {
    byName.set(s.name, {
      name: s.name,
      description: s.description,
      inAgentsDir: true,
      permissions: { ...(configured[s.name] ?? {}) },
    });
  }
  for (const [name, perms] of Object.entries(configured)) {
    const existing = byName.get(name);
    if (existing) existing.permissions = { ...perms };
    else byName.set(name, { name, inAgentsDir: false, permissions: { ...perms } });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
