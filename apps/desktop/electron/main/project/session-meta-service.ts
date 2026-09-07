import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 会话元数据注册表（T8.11 左栏「归档优先模型」）。
 *
 * pi-wood 侧 UI 状态（归档/置顶/显示别名），以 **Pi 会话文件的绝对路径为键**，
 * 落 `~/.pi-wood/session-meta.json`——与 projects.json 同级、同为应用侧状态（方案 §8.1）。
 * 刻意不写进 Pi 会话文件本身：CLI resume / T1.4 互通零影响；Pi 侧的 session name
 * 字段保持 CLI 语义不动，别名只在这张表里叠加。
 */

export interface SessionMeta {
  /** 归档：移出活跃列表，进「已归档」组（可恢复） */
  archived?: boolean;
  /** 置顶：排序恒在最前 */
  pinned?: boolean;
  /** 显示别名：覆盖「首条用户消息」标题；不落盘到 Pi 会话 */
  alias?: string;
  /** T9.2 v2.1：分叉谱系——本会话由哪个会话文件分叉而来（「从对话中派生」回跳用） */
  forkedFrom?: string;
}

export type SessionMetaMap = Record<string, SessionMeta>;

interface MetaFile {
  sessions: SessionMetaMap;
}

/** 合并 patch 并清掉「全空」条目（false/undefined 不留痕，注册表不积垃圾） */
export function applySessionMetaPatch(current: SessionMeta | undefined, patch: SessionMeta): SessionMeta | undefined {
  const next: SessionMeta = { ...current };
  if (patch.archived !== undefined) {
    if (patch.archived) next.archived = true;
    else delete next.archived;
  }
  if (patch.pinned !== undefined) {
    if (patch.pinned) next.pinned = true;
    else delete next.pinned;
  }
  if (patch.alias !== undefined) {
    const alias = patch.alias.trim();
    if (alias) next.alias = alias;
    else delete next.alias;
  }
  // T9.2 v2.1：分叉谱系（源会话文件路径）；空串视作删键
  if (patch.forkedFrom !== undefined) {
    const forkedFrom = patch.forkedFrom.trim();
    if (forkedFrom) next.forkedFrom = forkedFrom;
    else delete next.forkedFrom;
  }
  if (!next.archived && !next.pinned && !next.alias && !next.forkedFrom) return undefined;
  return next;
}

export class SessionMetaStore {
  private filePath: string;

  constructor(appDataDir: string) {
    this.filePath = join(appDataDir, "session-meta.json");
  }

  list(): SessionMetaMap {
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf-8")) as MetaFile;
      return raw.sessions ?? {};
    } catch {
      return {};
    }
  }

  get(file: string): SessionMeta | undefined {
    return this.list()[file];
  }

  set(file: string, patch: SessionMeta): SessionMeta | undefined {
    const reg = this.read();
    const next = applySessionMetaPatch(reg.sessions[file], patch);
    if (next) reg.sessions[file] = next;
    else delete reg.sessions[file];
    this.write(reg);
    return next;
  }

  clear(file: string): void {
    const reg = this.read();
    delete reg.sessions[file];
    this.write(reg);
  }

  private read(): MetaFile {
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf-8")) as MetaFile;
      return { sessions: raw.sessions ?? {} };
    } catch {
      return { sessions: {} };
    }
  }

  private write(reg: MetaFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(reg, null, 2));
  }
}
