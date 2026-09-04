/**
 * 审批 / ctx.ui 的对话归属纯逻辑（T8.4）
 *
 * 多对话并发（§7.9）后，审批与 ctx.ui 往返必须带「发起对话」归属，否则：
 * - 用户在 B 对话里误点 A 的审批卡 → 跨对话放行 = 安全旁路；
 * - `acceptAll` 遍历全局 → 替用户点头别的项目的写盘操作；
 * - 120s 超时一刀切 → 用户根本没看到的后台对话被静默判死。
 *
 * 判定全部收敛成本模块纯函数（node --test 穷举），有状态的一侧（Map/定时器）在
 * engine-manager.ts，只做「记录 + 调用」。
 */

/** pending 表的 key：`${conversationId}:${seq}`（无归属的全局请求用 `global` 兜底） */
export function pendingKey(conversationId: string | null | undefined, seq: number): string {
  return `${conversationId ?? "global"}:${seq}`;
}

/**
 * 应答者校验：应答者所处的对话必须是发起对话。
 * - owner === undefined/null：插件宿主等全局请求，不属于任何对话，任何对话均可应答；
 * - respondAs 缺省（旧渲染层）：一律拒绝——多对话下「不知道自己在替谁应答」等于不该应答。
 */
export function canRespond(owner: string | null | undefined, respondAs: string | null | undefined): boolean {
  if (!owner) return true;
  return Boolean(respondAs) && respondAs === owner;
}

/**
 * 超时分档（120s 一刀切在多对话下会把用户没看到的请求静默判死）：
 * - 发起对话是当前 active → 正常起 120s 计时（超时默认拒绝，方案 §9）；
 * - 非 active → 不计时（pending 常驻、红点常在），等用户切过去（setActiveConversation /
 *   approval:focus-requested）再起表。
 */
export function shouldArmTimeout(conversationId: string | null | undefined, activeId: string | undefined): boolean {
  if (!conversationId) return true; // 全局请求（插件）维持原语义：起表
  return conversationId === activeId;
}

/** 主进程对 child 审批票据的一次性消费判定（防重放：同一 ticket 只能背书一次裁决） */
export function checkApprovalTicket(
  seen: ReadonlySet<string>,
  ticket: unknown,
): { ok: true } | { ok: false; error: string } {
  if (typeof ticket !== "string" || ticket.length === 0) {
    return { ok: false, error: "审批请求缺一次性票据（ticket）" };
  }
  if (seen.has(ticket)) {
    return { ok: false, error: `审批票据已消费（疑似重放）：${ticket.slice(0, 8)}…` };
  }
  return { ok: true };
}

export interface PendingOwnerView {
  key: string;
  conversationId: string | null;
}

/**
 * acceptAll 的作用域过滤：只放行「该对话」的 pending。
 * 无归属的全局项（插件 confirm）不在此列——它们没有「跨对话」问题，但也不该被某条
 * 对话的「自动接受」连带放行（T8.4 收紧：acceptAll 语义 = 当前对话的审批，不多不少）。
 */
export function acceptAllScope<T extends PendingOwnerView>(
  entries: readonly T[],
  activeId: string | undefined,
): T[] {
  if (!activeId) return [];
  return entries.filter((e) => e.conversationId === activeId);
}

/**
 * PromptTray 的展示排序：同对话的请求相邻（按对话分组），组间按首次到达顺序。
 * 渲染层只管渲染，排序判据放这里可穷举单测。
 */
export function groupOrderByConversation<T extends { conversationId: string | null }>(
  items: readonly T[],
): T[] {
  const groupOrder: string[] = [];
  const index = new Map<string, number>();
  for (const item of items) {
    const g = item.conversationId ?? "global";
    if (!index.has(g)) {
      index.set(g, groupOrder.length);
      groupOrder.push(g);
    }
  }
  return [...items].sort(
    (a, b) => (index.get(a.conversationId ?? "global") ?? 0) - (index.get(b.conversationId ?? "global") ?? 0),
  );
}
