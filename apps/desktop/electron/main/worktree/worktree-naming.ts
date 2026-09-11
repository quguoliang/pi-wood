/**
 * worktree 命名与路径纯函数（T8.6）
 *
 * 只放可穷举判定的部分：worktree 路径 / 分支名 / 对话短 id / 非法字符与路径长度。
 * 实际的 git 操作在 worktree-service.ts（electron-free，可真 git 仓库单测）。
 */

/** worktree 根目录名（落在项目内，被 .gitignore 外的显式目录管理；随 close 回收） */
export const WORKTREE_DIRNAME = ".pi-wood/worktrees";

/** 分支命名空间（探索性分支统一前缀，回收时按前缀删） */
export const WORKTREE_BRANCH_PREFIX = "piwood/";

/**
 * 对话短 id：`conv-3-abc12345` → `abc12345`（uuid 段），无惯例格式则原样净化。
 * 这是 worktree 目录名与分支名的唯一来源。
 */
export function conversationShortId(conversationId: string): string {
  const m = conversationId.match(/^conv-\d+-([0-9a-zA-Z]+)$/);
  const raw = m ? m[1] : conversationId;
  return sanitizeSegment(raw) || "wt";
}

/**
 * 净化路径段：Windows 非法字符 <>:"/\|?* 与控制符 → `-`；去前后空白与结尾点（Windows 目录名禁忌）；
 * 统一小写（macOS/Windows 文件系统大小写不敏感，两个只差大小写的对话 id 不得共用/冲突同名树）。
 * 空结果回落 `wt`（调用方保证有可用段）。
 */
export function sanitizeSegment(segment: string): string {
  const cleaned = segment
    .toLowerCase()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .replace(/\s+/g, "-");
  return cleaned.length > 0 ? cleaned : "wt";
}

/** 该对话的 worktree 绝对路径：`<projectDir>/.pi-wood/worktrees/<shortId>` */
export function worktreePathFor(projectDir: string, conversationId: string): string {
  const base = projectDir.replace(/[\\/]+$/, "");
  const joiner = base.includes("\\") ? "\\" : "/";
  return `${base}${joiner}${WORKTREE_DIRNAME.replace(/\//g, joiner)}${joiner}${conversationShortId(conversationId)}`;
}

/** 该对话的 worktree 分支名：`piwood/<shortId>` */
export function branchFor(conversationId: string): string {
  return `${WORKTREE_BRANCH_PREFIX}${conversationShortId(conversationId)}`;
}

/** 路径长度护栏（Windows MAX_PATH 留余量；超限由调用方给出「缩短项目路径」的显式提示） */
export function isPathLengthOk(path: string, limit = 240): boolean {
  return path.length <= limit;
}

/**
 * 该工作树是否由 **本项目** 管辖（孤儿对账与回收共用同一判据，且两者必须同集合，不碰用户自建的树）：
 * 路径归一后必须落在 `<projectDir>/.pi-wood/worktrees/` **之内**（严格子路径，`worktrees-old` 这类同前缀兄弟目录不算）。
 *
 * ⚠️ 2026-09-11 修：原实现有一条 `if (branch?.startsWith("piwood/")) return true` 的短路，
 * **只看分支前缀不看路径**。而 `git worktree list` 是按**仓库**枚举的——同一仓库内、位于**子目录**下建的树同样带
 * `piwood/` 前缀，于是被误算进外层项目的孤儿列表：pi-wood 项目会列出 `apps/desktop/scratch/test-project/`
 * 下的 7 棵树，而回收守卫 `removeManagedWorktreeByPath` 只按路径校验，必然拒绝 → **列得出、删不掉**。
 * 分支前缀因此是「必要不充分」条件，不再作为判据。
 *
 * 目录已被手工删除的「幽灵记录」（git 仍留注册项）不受影响：其路径字符串仍在管辖前缀内，照常判为管辖，
 * 由 `removeManagedWorktreeByPath` 的幂等分支 prune 掉。
 */
export function isManagedWorktree(absPath: string, projectDir: string): boolean {
  // 统一分隔符后再比较：Windows 反斜杠路径与 `git worktree list` 的斜杠输出一致对待（\→/ 一对一，索引不漂移）
  const norm = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const base = `${norm(projectDir)}/${WORKTREE_DIRNAME}`;
  return norm(absPath).startsWith(`${base}/`);
}

/**
 * T8.7 记忆/项目级资源 scope 归一：worktree 路径归到主项目根。
 * `<proj>/.pi-wood/worktrees/<id>` → `<proj>`；非管辖路径原样返回。
 * 否则每个对话各写一份 `<worktree>/.pi-wood/memory/project.json`，记忆被切碎（T7.10 偏差 b）。
 */
export function mainProjectRootOf(dir: string): string {
  if (!dir) return dir;
  const norm = dir.replace(/[\\/]+$/, "");
  // 统一分隔符后再匹配（Windows 反斜杠路径同样归一；\→/ 一对一替换，索引不漂移）
  const unified = norm.replace(/\\/g, "/");
  const marker = "/.pi-wood/worktrees/";
  const idx = unified.toLowerCase().indexOf(marker);
  if (idx <= 0) return dir;
  return norm.slice(0, idx);
}
