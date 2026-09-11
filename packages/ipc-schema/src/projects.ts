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
 * 用户消息的附件/引用元数据（发送时随消息持久化，气泡与历史回填共用）。
 * thumb 是可选的小尺寸 dataURL（图片才有），气泡/hover 预览直接渲染，免二次读盘。
 */
export const MessageAttachmentSchema = z.object({
  path: z.string(),
  name: z.string(),
  size: z.number(),
  kind: z.enum(["file", "image"]),
  thumb: z.string().optional(),
});
export type MessageAttachment = z.infer<typeof MessageAttachmentSchema>;

export const MessageSnippetSchema = z.object({
  path: z.string(),
  name: z.string(),
  start: z.number(),
  end: z.number(),
  snippet: z.string(),
});
export type MessageSnippet = z.infer<typeof MessageSnippetSchema>;

export const MessageMetaSchema = z.object({
  attachments: z.array(MessageAttachmentSchema).optional(),
  snippets: z.array(MessageSnippetSchema).optional(),
});
export type MessageMeta = z.infer<typeof MessageMetaSchema>;

/**
 * T8.11 会话元数据域：pi-wood 侧 UI 状态（归档/置顶/别名），以会话文件绝对路径为键，
 * 落 `~/.pi-wood/session-meta.json`，不写 Pi 会话文件（CLI resume / 互通零影响）。
 * messages 以 Pi 会话条目的 entryId 为键，记录每条用户消息的附件/引用（气泡展示 + 历史回填）。
 */
export const SessionMetaSchema = z.object({
  archived: z.boolean().optional(),
  pinned: z.boolean().optional(),
  alias: z.string().optional(),
  /** T9.2 v2.1：本会话由哪个会话文件分叉而来（「从对话中派生」回跳用；键仍是本会话文件） */
  forkedFrom: z.string().optional(),
  messages: z.record(z.string(), MessageMetaSchema).optional(),
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
  /** Pi 会话条目 id（分支过滤下稳定）；用户消息的附件/引用元数据以它为键回填 */
  entryId: z.string().optional(),
  attachments: z.array(MessageAttachmentSchema).optional(),
  snippets: z.array(MessageSnippetSchema).optional(),
});
export type SessionMessageItem = z.infer<typeof SessionMessageItemSchema>;

/** 图片缩略图域：返回小尺寸 dataURL（气泡/hover 预览用，避免渲染进程直接读盘） */
export const FS_THUMB_CHANNEL = "fs:thumb";

// invoke 入参
export const PathArgSchema = z.object({ path: z.string().min(1) });
export const IdArgSchema = z.object({ id: z.string().min(1) });
export const FileArgSchema = z.object({ file: z.string().min(1) });
