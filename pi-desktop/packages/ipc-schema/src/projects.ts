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
});

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
  trustStatus: "project:trustStatus",
  onChanged: "project:onChanged",
} as const;

export const SESSION_CHANNELS = {
  list: "sessions:list",
  tree: "sessions:tree",
  messages: "sessions:messages",
} as const;

export const SessionMessageItemSchema = z.object({
  role: z.enum(["user", "assistant", "tool"]),
  text: z.string(),
});
export type SessionMessageItem = z.infer<typeof SessionMessageItemSchema>;

// invoke 入参
export const PathArgSchema = z.object({ path: z.string().min(1) });
export const IdArgSchema = z.object({ id: z.string().min(1) });
export const FileArgSchema = z.object({ file: z.string().min(1) });
