import { z } from "zod";

/** 项目/会话域 IPC 契约（T1.4 左栏数据层，方案 §3.2） */

export const ProjectRecordSchema = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string(),
  addedAt: z.string(),
  lastOpenedAt: z.string(),
});
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;

export const TrustStatusSchema = z.enum(["trusted", "untrusted", "undecided", "not-required"]);
export type TrustStatus = z.infer<typeof TrustStatusSchema>;

export const SessionListItemSchema = z.object({
  file: z.string(),
  id: z.string(),
  name: z.string().optional(),
  created: z.string(),
  modified: z.string(),
  messageCount: z.number(),
  firstMessage: z.string(),
});
export type SessionListItem = z.infer<typeof SessionListItemSchema>;

export const SessionTreeRowSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  type: z.string(),
  depth: z.number(),
  activeBranch: z.boolean(),
  timestamp: z.string(),
  /**
   * T9.2 上下文缩略树 v2：消息条目的角色与首行摘要（非 message 条目缺席）。
   * 渲染层给「旁支节点」出题面用；只做展示投影，不参与引擎语义。
   */
  role: z.enum(["user", "assistant", "tool", "other"]).optional(),
  textHead: z.string().optional(),
});

/**
 * T9.2：`sessions:messages` 入参。`leafId` 给出时主进程只返回 root→leaf 路径上的消息
 * （transcript 按分支过滤）；缺席 = 旧行为（文件序全量）。
 */
export const SessionMessagesArgSchema = z.object({
  file: z.string().min(1),
  leafId: z.string().min(1).optional(),
});
export type SessionMessagesArg = z.infer<typeof SessionMessagesArgSchema>;

export const SessionTreeResultSchema = z.object({
  sessionId: z.string().optional(),
  totalEntries: z.number(),
  rows: z.array(SessionTreeRowSchema),
  defaultLeafId: z.string().optional(),
});
export type SessionTreeResult = z.infer<typeof SessionTreeResultSchema>;

export const PROJECT_CHANNELS = {
  list: "project:list",
  add: "project:add",
  remove: "project:remove",
  /** T8.11：改显示别名（只写 projects.json，目录与磁盘零触碰） */
  rename: "project:rename",
  trustStatus: "project:trustStatus",
  onChanged: "project:onChanged",
} as const;

export const SESSION_CHANNELS = {
  list: "sessions:list",
  tree: "sessions:tree",
  messages: "sessions:messages",
} as const;

/**
 * T8.11 会话元数据域：pi-wood 侧 UI 状态（归档/置顶/别名），以会话文件绝对路径为键，
 * 落 `~/.pi-wood/session-meta.json`，不写 Pi 会话文件（CLI resume / 互通零影响）。
 */
export const SessionMetaSchema = z.object({
  archived: z.boolean().optional(),
  pinned: z.boolean().optional(),
  alias: z.string().optional(),
});
export type SessionMeta = z.infer<typeof SessionMetaSchema>;
export const SessionMetaMapSchema = z.record(z.string(), SessionMetaSchema);
export type SessionMetaMap = z.infer<typeof SessionMetaMapSchema>;

export const SESSION_META_CHANNELS = {
  /** 拉全量映射（键数 = 用户手动管理过的会话数，量级很小，不做增量） */
  get: "sessions:meta",
  set: "sessions:setMeta",
  /** 销毁会话文件（CLI 亦不可恢复）：主进程守卫「被活跃对话认领即拒」 */
  delete: "sessions:delete",
} as const;

export const SessionMetaPatchSchema = z.object({ file: z.string().min(1), patch: SessionMetaSchema });
export const ProjectRenameArgSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });

export const SessionMessageItemSchema = z.object({
  role: z.enum(["user", "assistant", "tool"]),
  text: z.string(),
});
export type SessionMessageItem = z.infer<typeof SessionMessageItemSchema>;

// invoke 入参
export const PathArgSchema = z.object({ path: z.string().min(1) });
export const IdArgSchema = z.object({ id: z.string().min(1) });
export const FileArgSchema = z.object({ file: z.string().min(1) });
