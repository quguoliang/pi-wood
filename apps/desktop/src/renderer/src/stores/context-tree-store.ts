import { create } from "zustand";
import { defaultLeafId, deriveContextTree, type TreeRowLike } from "../lib/context-tree.ts";

/**
 * T9.2 上下文缩略树 v2 的树数据 store（渲染层）。
 *
 * 数据源是 `sessions:tree`（主进程读 Pi 会话 jsonl，与左栏 HistoryPane 同源）——
 * **文件即事实**：引擎 leaf 不落盘（SDK 重开会话总是回到追加序尾部），所以「当前在看哪条分支」
 * 是渲染层状态：默认叶 = 时间戳最新末梢；用户切分支后记住手选叶（manuallySwitched），
 * 新流量落在手选叶上时它仍是最新末梢，叶标记自动跟随新尾部。
 *
 * 刷新时机（都是低频）：切到对话 / 一轮 agent_settled / 切分支后。不在流式中刷（省 IPC，
 * 且流式中的行内导航由 v1 大纲从 DisplayRow 派生，不依赖树）。
 */

export interface ConversationTree {
  /** 树数据对应的会话文件；文件换了（fork/新会话）旧行作废 */
  file: string;
  rows: TreeRowLike[];
  /** 主进程给的默认叶（时间戳最新末梢；与渲染层 defaultLeafId 同启发，直接采信省一趟计算） */
  defaultLeafId?: string;
  /** 当前视图叶：手选优先，否则默认 */
  leafId: string | undefined;
  /** 用户切过分支（此后自动跟随策略保守：不再被 defaultLeaf 刷新覆盖） */
  manuallySwitched: boolean;
  /** 手选发生时的默认尾——只有它「确实前移」才认为用户在该分支上继续了对话（解除手选） */
  defaultAtLastSwitch?: string;
  loading: boolean;
  error: string | undefined;
}

interface ContextTreeStore {
  byConv: Record<string, ConversationTree>;
  refresh(conversationId: string, file: string, opts?: { force?: boolean }): Promise<void>;
  /** 切分支后由调用方设定新叶（null = 退回默认叶策略） */
  setLeaf(conversationId: string, leafId: string | null): void;
  clear(conversationId: string): void;
}

/** 同对话并发 refresh 去重（切换抖动/轮末+切回同时触发时只读一次文件） */
const inFlight = new Map<string, Promise<void>>();

export const useContextTreeStore = create<ContextTreeStore>((set, get) => ({
  byConv: {},

  async refresh(conversationId, file, opts) {
    const cached = get().byConv[conversationId];
    if (cached && cached.file === file && !cached.error && !opts?.force) return;
    const running = inFlight.get(conversationId);
    if (running && cached?.file === file) return void running;
    const p = (async (): Promise<void> => {
      try {
        const res = (await window.pi.sessionsTree(file)) as {
          rows?: TreeRowLike[];
          defaultLeafId?: string;
        };
        const rows = Array.isArray(res?.rows) ? res.rows : [];
        const dflt = res?.defaultLeafId ?? defaultLeafId(rows);
        set((s) => {
          const prev = s.byConv[conversationId];
          // 叶保持规则：
          // 1) 手选叶仍是新默认叶的**祖先**（切过分支后又在这条分支上继续聊了）→ 自动跟随默认叶并解除手选，
          //    否则新回复会挂在视图叶之下被当成旁支、且路径过滤看不见新内容（切分支后继续对话的常态）。
          // 2) 手选叶仍存在且不满足 1（真停留在被选的历史节点上）→ 保留。
          // 3) 手选叶消失（数据异常）→ 回落默认。
          let keepManual = false;
          if (prev?.manuallySwitched && prev.leafId) {
            if (dflt && prev.leafId === dflt) {
              keepManual = false; // 手选叶就是当前尾（聊到这里了），回到自动跟随
            } else if (dflt && prev.leafId && rows.some((r) => r.id === prev.leafId)) {
              const tailAdvanced = prev.defaultAtLastSwitch != null && dflt !== prev.defaultAtLastSwitch;
              const onNewTailPath = tailAdvanced && deriveContextTree(rows, dflt).pathIds.includes(prev.leafId);
              keepManual = !onNewTailPath; // 仅当「用户确实在这条分支上又聊出新尾」才解除；纯浏览保持手选
            }
          }
          const nextLeaf = keepManual ? prev?.leafId : dflt;
          return {
            byConv: {
              ...s.byConv,
              [conversationId]: {
                file,
                rows,
                defaultLeafId: dflt,
                leafId: nextLeaf,
                manuallySwitched: keepManual,
                loading: false,
                error: undefined,
              },
            },
          };
        });
      } catch (err) {
        set((s) => ({
          byConv: {
            ...s.byConv,
            [conversationId]: {
              file,
              rows: [],
              defaultLeafId: undefined,
              leafId: undefined,
              manuallySwitched: false,
              loading: false,
              error: err instanceof Error ? err.message : String(err),
            },
          },
        }));
      } finally {
        inFlight.delete(conversationId);
      }
    })();
    inFlight.set(conversationId, p);
    await p;
  },

  setLeaf(conversationId, leafId) {
    set((s) => {
      const prev = s.byConv[conversationId];
      if (!prev) return s;
      const next = leafId ?? prev.defaultLeafId;
      return {
        byConv: {
          ...s.byConv,
          [conversationId]: {
            ...prev,
            leafId: next,
            manuallySwitched: leafId != null && leafId !== prev.defaultLeafId,
            defaultAtLastSwitch: leafId != null ? prev.defaultLeafId : undefined,
          },
        },
      };
    });
  },

  clear(conversationId) {
    set((s) => {
      if (!s.byConv[conversationId]) return s;
      const next = { ...s.byConv };
      delete next[conversationId];
      return { byConv: next };
    });
  },
}));
