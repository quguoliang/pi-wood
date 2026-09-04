/**
 * T8.8 对话标签条的状态→徽章映射（纯函数，可穷举单测）。
 * 优先级：审批红点 > 在飞转圈 > 排队 > 启动中虚线 > 关停灰 > 有未读蓝点 > 普通。
 */

/** 与主进程 conversation-core.ConversationStatus 同源的字面量并集（渲染层不 import 主进程模块，手动同步） */
export type ConversationStatus =
  | "spawning"
  | "idle"
  | "streaming"
  | "waiting_approval"
  | "queued"
  | "suspended"
  | "dead";

export type TabBadge =
  | "approval" // 红点：待审批（用户没看到会被 T8.4 分档保活，必须显眼）
  | "streaming" // 转圈：任务在跑
  | "queued" // 排队中（T8.5 prompt 闸门）
  | "spawning" // 虚线：引擎启动中
  | "resting" // 灰：已关停/休眠/崩溃
  | "unread" // 蓝点：有未读新回复
  | "none";

export function badgeFor(status: ConversationStatus, opts: { pendingApprovals: number; inFlightPrompt: boolean; unread: number }): TabBadge {
  if (opts.pendingApprovals > 0 || status === "waiting_approval") return "approval";
  if (opts.inFlightPrompt || status === "streaming") return "streaming";
  if (status === "queued") return "queued";
  if (status === "spawning") return "spawning";
  if (status === "suspended" || status === "dead") return "resting";
  if (opts.unread > 0) return "unread";
  return "none";
}

/** 标签标题：首条用户消息（与会话列表同源）→ 截断；缺省回落「项目名 · 对话 N」 */
export function tabTitle(firstUserMessage: string | undefined, projectDir: string, conversationId: string): string {
  const t = firstUserMessage?.replace(/\s+/g, " ").trim();
  if (t) return t.length > 24 ? `${t.slice(0, 24)}…` : t;
  const project = projectDir.split(/[\\/]/).filter(Boolean).pop() ?? "项目";
  const m = conversationId.match(/^conv-(\d+)-/);
  return m ? `${project} · 对话 ${m[1]}` : `${project} · ${conversationId.slice(-6)}`;
}
