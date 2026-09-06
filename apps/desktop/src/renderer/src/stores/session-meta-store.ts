import { create } from "zustand";

/**
 * 会话元数据（T8.11：归档/置顶/别名）的渲染层缓存。
 * 单一数据源在主进程 `~/.pi-wood/session-meta.json`；这里只做拉取 + 乐观写回。
 * 量级很小（= 用户手动管理过的会话数），整表拉取不做增量。
 */

export interface SessionMeta {
  archived?: boolean;
  pinned?: boolean;
  alias?: string;
}

interface SessionMetaState {
  meta: Record<string, SessionMeta>;
  load(): Promise<void>;
  /** 乐观更新 + 主进程落盘；失败回滚由下次 load 兜底 */
  set(file: string, patch: SessionMeta): Promise<void>;
}

export const useSessionMetaStore = create<SessionMetaState>((set, get) => ({
  meta: {},

  async load() {
    try {
      const m = (await window.pi.sessionsMeta?.()) as Record<string, SessionMeta> | undefined;
      if (m) set({ meta: m });
    } catch {
      /* 主进程未就绪时静默，轮询/下次操作会再拉 */
    }
  },

  async set(file, patch) {
    const prev = get().meta;
    const next = { ...prev[file], ...patch };
    // 与主进程 applySessionMetaPatch 同口径：全空即删键
    if (!next.archived && !next.pinned && !next.alias?.trim()) delete next.alias;
    set({ meta: { ...prev, [file]: next } });
    try {
      await window.pi.sessionsSetMeta?.(file, patch);
    } catch (err) {
      set({ meta: prev });
      throw err;
    }
  },
}));
