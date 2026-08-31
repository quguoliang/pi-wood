import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { diffLines } from "diff";

/**
 * 快照与 Diff 服务（T2.2，方案 §10.4 正式化）。
 * - 在 edit/write 工具执行前后对目标文件做快照，产出 patch 推送右栏
 * - T1.5 实测修复：工具入参 path 可能是相对路径，必须 path.resolve 到项目目录；
 *   错误不再静默吞掉，走 warn 日志
 */
export class SnapshotService {
  private before = new Map<string, string>();
  private projectDir: string;
  private warn: (msg: string) => void;

  constructor(projectDir: string, warn?: (msg: string) => void) {
    this.projectDir = projectDir;
    this.warn = warn ?? (() => {});
  }

  /** 工具入参 path（相对或绝对）→ 项目内绝对路径；越界返回 undefined */
  resolveInProject(p: string): string | undefined {
    const full = isAbsolute(p) ? normalize(p) : join(this.projectDir, p);
    const norm = normalize(full);
    return norm.startsWith(this.projectDir) ? norm : undefined;
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
  collectChanges(): Array<{ file: string; before: string; after: string }> {
    const out: Array<{ file: string; before: string; after: string }> = [];
    for (const [full, before] of this.before) {
      try {
        const after = existsSync(full) ? readFileSync(full, "utf-8") : "";
        if (before === after) continue;
        out.push({ file: full.slice(this.projectDir.length + 1), before, after });
      } catch (err) {
        this.warn(`[snapshot] diff 失败 ${full}: ${String(err)}`);
      }
    }
    this.before.clear();
    return out;
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
