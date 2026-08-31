import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { diffLines } from "diff";

export interface SnapshotChange {
  id: string;
  file: string;
  before: string;
  after: string;
}

/**
 * 快照与 Diff 服务（T2.2，方案 §10.4 正式化）。
 * - 在 edit/write 工具执行前后对目标文件做快照，产出 patch 推送右栏
 * - T1.5 实测修复：工具入参 path 可能是相对路径，必须 path.resolve 到项目目录；
 *   错误不再静默吞掉，走 warn 日志
 */
export class SnapshotService {
  private before = new Map<string, string>();
  private changes = new Map<string, { full: string; before: string; after: string }>();
  private sequence = 0;
  private projectDir: string;
  private warn: (msg: string) => void;

  constructor(projectDir: string, warn?: (msg: string) => void) {
    this.projectDir = resolve(projectDir);
    this.warn = warn ?? (() => {});
  }

  /** 工具入参 path（相对或绝对）→ 项目内绝对路径；越界返回 undefined */
  resolveInProject(p: string): string | undefined {
    const full = resolve(isAbsolute(p) ? p : resolve(this.projectDir, p));
    const rel = relative(this.projectDir, full);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)) ? full : undefined;
  }

  snapshot(toolName: string, input: unknown): void {
    if (toolName !== "edit" && toolName !== "write") return;
    const path = (input as { path?: string } | undefined)?.path;
    if (!path) return;
    const full = this.resolveInProject(path);
    if (!full) {
      this.warn(`[snapshot] 越界路径已忽略: ${path}`);
      return;
    }
    try {
      this.before.set(full, existsSync(full) ? readFileSync(full, "utf-8") : "");
    } catch (err) {
      this.warn(`[snapshot] 读取失败 ${path}: ${String(err)}`);
    }
  }

  /** 返回发生变化的文件 before/after（供 MergeView），并清理快照 */
  collectChanges(): SnapshotChange[] {
    const out: SnapshotChange[] = [];
    for (const [full, before] of this.before) {
      try {
        const after = existsSync(full) ? readFileSync(full, "utf-8") : "";
        if (before === after) continue;
        const file = relative(this.projectDir, full);
        const id = `change-${++this.sequence}`;
        this.changes.set(id, { full, before, after });
        out.push({ id, file, before, after });
      } catch (err) {
        this.warn(`[snapshot] diff 失败 ${full}: ${String(err)}`);
      }
    }
    this.before.clear();
    return out;
  }

  /**
   * 恢复一次已收集的变更。若文件在 Diff 生成后又发生变化则拒绝覆盖，
   * 防止较旧快照破坏后续编辑。写回原始字符串可保留 CRLF/BOM 字节。
   */
  revert(changeId: string): { file: string; content: string } {
    const change = this.changes.get(changeId);
    if (!change) throw new Error("变更快照不存在或已失效");
    const current = existsSync(change.full) ? readFileSync(change.full, "utf-8") : "";
    if (current !== change.after) throw new Error("文件在生成 Diff 后已再次修改，拒绝覆盖");
    writeFileSync(change.full, change.before, "utf-8");
    this.changes.delete(changeId);
    return { file: relative(this.projectDir, change.full), content: change.before };
  }

  /** 兼容旧口径：行级 patch 文本 */
  collectPatches(): Array<{ file: string; patch: string }> {
    return this.collectChanges().map(({ file, before, after }) => ({
      file,
      patch: diffLines(before, after)
        .map((part) => (part.added ? "+ " : part.removed ? "- " : "  ") + part.value)
        .join(""),
    }));
  }
}
