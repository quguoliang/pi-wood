/**
 * 对话切片（T8.3）—— 渲染层「一条对话一份状态」的**纯归约**层。
 *
 * 为什么单独成文件：session-store 里那套 `switch(event.type)` 是 T8.3 全部验收项的地基
 * （乱序/交错/串台/未读/摘要都得能确定性复现），但它原先长在 zustand store 的闭包里，
 * 依赖 `set/get/Date.now/模块级 seq`——没法喂事件序列做穷举单测。这里把它抽成
 * `(slice, event, ctx) => slice` 的纯函数，ctx 注入 `now` 与 `nextId`，于是：
 * - `conversation-slice.test.ts` 可以直接灌两路交错事件流，断言互不污染；
 * - 主进程的可见性节流（同一套事件分类）与渲染层的归约共享判据，不会两边各写一份漂移。
 *
 * 不变量（都被单测盯着）：
 * 1. 纯：不读全局、不改入参 slice（返回新对象；未变更时 `changed=false` 让调用方跳过 setState）。
 * 2. live buffer 只属于本切片 ⇒ 后台对话的 token 永远不会糊进前台的尾巴。
 * 3. `unreadCount` 只在「非可见」时累加，且只数**里程碑**（否则每 token +1，切过去清零毫无意义）。
 */

export type ToolStatus = "running" | "ok" | "error";

export interface DiffStat {
  added: number;
  deleted: number;
}

export type ConversationItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "thinking"; text: string; durationMs?: number }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      name: string;
      args: Record<string, unknown>;
      status: ToolStatus;
      output?: string;
      diff?: string;
      diffStat?: DiffStat;
      truncated?: boolean;
      fullOutputPath?: string;
      /** T5.6：工具开始时刻（epoch ms），用于分组总耗时聚合。 */
      startedAt?: number;
      /** T5.6：工具耗时（ms），tool_execution_end 时由 startedAt 推算。 */
      durationMs?: number;
    }
  | {
      id: string;
      kind: "system";
      text: string;
      tone: "info" | "warn" | "error" | "success";
      align?: "center" | "start";
    };

export interface HistoryMessageItem {
  role: string;
  text: string;
  toolCallId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  isError?: boolean;
}

/** 一条对话的全部视图状态。字段即 T8.3 步骤 1 里列的那一份。 */
export interface ConversationSlice {
  items: ConversationItem[];
  /** 流式中的正文/思考尾巴（每对话独立 ⇒ 后台流不会串进前台尾块） */
  liveText: string;
  liveThinking: string;
  streaming: boolean;
  queue: { steering: string[]; followUp: string[] };
  engineReady: boolean;
  currentSessionId: string | undefined;
  /** 后台累计的「值得看一眼」的事件数；切过去即清零 */
  unreadCount: number;
  /** 该对话有审批待应答（标签红点） */
  hasPendingApproval: boolean;
  /** 滚动位置与「是否跟底」按对话独立保持 */
  scrollTop: number;
  followBottom: boolean;
  /** 历史是否已整读装载（未装载时切过去要先 loadMessages 对账） */
  historyLoaded: boolean;
  /** 已应用的最后一个事件帧 seq（对账用；-1 = 还没收到过） */
  lastSeq: number;
  /** 断号累计（丢帧不许静默） */
  droppedEvents: number;
  /** 后台标签摘要用：本轮已发生的工具调用数 / 正在跑的工具数 */
  toolCallCount: number;
  runningToolCount: number;
  /** 最近一次里程碑（文本摘要，标签上直接显） */
  lastMilestone: string | undefined;
  /** thinking 块的起点（原先是 store 里的模块级变量，多对话下必须归各自切片） */
  thinkingStartedAt: number | undefined;
  /** T8.3 内存护栏：超过单对话上限后被裁掉的头部条数（>0 时列表顶部给「上滑加载更早」入口） */
  headTrimmed: number;
}

export function emptySlice(): ConversationSlice {
  return {
    items: [],
    liveText: "",
    liveThinking: "",
    streaming: false,
    queue: { steering: [], followUp: [] },
    engineReady: false,
    currentSessionId: undefined,
    unreadCount: 0,
    hasPendingApproval: false,
    scrollTop: 0,
    followBottom: true,
    historyLoaded: false,
    lastSeq: -1,
    droppedEvents: 0,
    toolCallCount: 0,
    runningToolCount: 0,
    lastMilestone: undefined,
    thinkingStartedAt: undefined,
    headTrimmed: 0,
  };
}

export interface SliceCtx {
  /** 时间注入（单测要确定性） */
  now: number;
  /** item id 生成器注入（避免模块级自增跨切片串号） */
  nextId: () => string;
  /** 该事件是否发生在「用户正看着这条对话」时：决定要不要计 unread */
  visible?: boolean;
  /** child 帧号（T8.2 envelope 透传；用于乱序/丢帧对账） */
  seq?: number;
}

export interface SliceResult {
  slice: ConversationSlice;
  /** 未变更 ⇒ 调用方可以完全跳过 setState，不触发任何重渲染 */
  changed: boolean;
  /** 里程碑事件（切后台时只推这类，见 ipc-schema 的节流判据） */
  milestone: boolean;
}

const same = (a: ConversationSlice, milestone = false): SliceResult => ({ slice: a, changed: false, milestone });

const withUnread = (base: ConversationSlice, milestone: boolean, visible: boolean | undefined): ConversationSlice => {
  if (!milestone || visible === true) return base;
  return { ...base, unreadCount: base.unreadCount + 1 };
};

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
};

/** 把工具结果/部分内容（content 数组块或字符串）解成可读文本。 */
export const extractText = (result: unknown): string | undefined => {
  if (result === undefined || result === null) return undefined;
  if (typeof result === "string") return result;
  const content = (result as { content?: unknown }).content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : part && typeof part === "object" && (part as { type?: unknown }).type === "image"
            ? "[图片]"
            : "",
      )
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }
  if (typeof (result as { text?: unknown }).text === "string") return (result as { text: string }).text;
  if (typeof (result as { message?: unknown }).message === "string") return (result as { message: string }).message;
  return safeStringify(result);
};

/** 从 unified patch 统计 +/- 行数（排除 +++/--- 文件头）。 */
export const statPatch = (patch: string): DiffStat => {
  let added = 0;
  let deleted = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) deleted += 1;
  }
  return { added, deleted };
};

const asArgs = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : v === undefined
      ? {}
      : { value: v };

type ToolItem = Extract<ConversationItem, { kind: "tool" }>;

/** 把 live thinking/text 落成 finalized items（保证与后续工具的先后顺序） */
export function flushLive(base: ConversationSlice, ctx: SliceCtx): { slice: ConversationSlice; flushed: boolean } {
  const additions: ConversationItem[] = [];
  let thinkingStartedAt = base.thinkingStartedAt;
  if (base.liveThinking.trim()) {
    additions.push({
      id: ctx.nextId(),
      kind: "thinking",
      text: base.liveThinking,
      durationMs: thinkingStartedAt ? ctx.now - thinkingStartedAt : undefined,
    });
    thinkingStartedAt = undefined;
  }
  if (base.liveText.trim()) additions.push({ id: ctx.nextId(), kind: "assistant", text: base.liveText });
  if (additions.length === 0) {
    if (!base.liveText && !base.liveThinking) return { slice: base, flushed: false };
    return { slice: { ...base, liveText: "", liveThinking: "" }, flushed: false };
  }
  return {
    slice: { ...base, items: [...base.items, ...additions], liveText: "", liveThinking: "", thinkingStartedAt },
    flushed: true,
  };
}

const pushItem = (base: ConversationSlice, item: ConversationItem): ConversationSlice => ({
  ...base,
  items: [...base.items, item],
});

const updateTool = (base: ConversationSlice, toolCallId: string, patch: Partial<ToolItem>): ConversationSlice => {
  let hit = false;
  const items = base.items.map((m) => {
    if (m.kind !== "tool" || m.toolCallId !== toolCallId) return m;
    hit = true;
    return { ...m, ...patch };
  });
  if (!hit) return base;
  const runningToolCount = items.filter((m) => m.kind === "tool" && m.status === "running").length;
  return { ...base, items, runningToolCount };
};

/** 历史装载 + 与已收增量对账去重（T8.3 步骤 4：切到后台对话时不出现双份历史） */
export function mergeHistory(
  base: ConversationSlice,
  history: HistoryMessageItem[],
  ctx: SliceCtx,
): { slice: ConversationSlice; deduped: number } {
  const built: ConversationItem[] = history.map((m): ConversationItem => {
    if (m.role === "tool") {
      return {
        id: ctx.nextId(),
        kind: "tool",
        toolCallId: m.toolCallId ?? ctx.nextId(),
        name: m.toolName ?? "tool",
        args: m.toolInput ?? {},
        status: m.isError ? "error" : "ok",
        output: m.text || undefined,
      };
    }
    if (m.role === "user") return { id: ctx.nextId(), kind: "user", text: m.text };
    if (m.role === "assistant") return { id: ctx.nextId(), kind: "assistant", text: m.text };
    return { id: ctx.nextId(), kind: "system", tone: "info", text: m.text };
  });
  // 对账键：kind + 文本/工具调用号。已收增量（live 落地的尾巴）优先保留，历史只补前段。
  const keyOf = (i: ConversationItem): string =>
    i.kind === "tool" ? `tool:${i.toolCallId}` : i.kind === "system" ? `sys:${i.text}` : `${i.kind}:${i.text}`;
  const seen = new Set(base.items.map(keyOf));
  let deduped = 0;
  const missing = built.filter((i) => {
    if (seen.has(keyOf(i))) {
      deduped += 1;
      return false;
    }
    seen.add(keyOf(i));
    return true;
  });
  const items = [...missing, ...base.items];
  return {
    slice: {
      ...base,
      items,
      liveText: "",
      liveThinking: "",
      streaming: false,
      historyLoaded: true,
      toolCallCount: items.filter((i) => i.kind === "tool").length,
      runningToolCount: items.filter((i) => i.kind === "tool" && i.status === "running").length,
    },
    deduped,
  };
}

/**
 * 事件归约：一条事件进一个切片。
 * 语义与 T8.2 之前 store 里的 switch 逐条等价（那是回归底线），新增的只有
 * unread / 里程碑摘要 / runningToolCount / seq 对账这几项记账。
 */
export function applyEngineEvent(
  incoming: ConversationSlice,
  e: Record<string, unknown>,
  ctx: SliceCtx,
): SliceResult {
  const type = typeof e.type === "string" ? e.type : "";
  let slice = incoming;

  // seq 对账（T8.2 把 child 帧号随 envelope 透传上来，断号必须可见）
  const seq = ctx.seq;
  if (typeof seq === "number") {
    if (seq <= slice.lastSeq) return { slice, changed: false, milestone: false }; // 重复/倒退帧
    if (slice.lastSeq >= 0 && seq > slice.lastSeq + 1) {
      slice = { ...slice, droppedEvents: slice.droppedEvents + (seq - slice.lastSeq - 1) };
    }
    slice = { ...slice, lastSeq: seq };
  }

  switch (type) {
    case "user_message": {
      const f = flushLive(slice, ctx);
      const next = pushItem(f.slice, { id: ctx.nextId(), kind: "user", text: String(e.text ?? "") });
      return { slice: withUnread(next, true, ctx.visible), changed: true, milestone: true };
    }
    case "agent_start":
      slice = { ...slice, streaming: true };
      return { slice: withUnread(slice, true, ctx.visible), changed: true, milestone: true };
    case "agent_end":
    case "agent_settled": {
      const f = flushLive(slice, ctx);
      const next: ConversationSlice = {
        ...f.slice,
        streaming: false,
        queue: { steering: [], followUp: [] },
        runningToolCount: 0,
      };
      return { slice: withUnread(next, true, ctx.visible), changed: true, milestone: true };
    }
    case "message_end": {
      const f = flushLive(slice, ctx);
      return f.slice === slice ? same(slice, false) : { slice: f.slice, changed: true, milestone: false };
    }
    case "message_update": {
      const a = e.assistantMessageEvent as { type?: string; delta?: unknown } | undefined;
      if (!a) return same(slice);
      switch (a.type) {
        case "thinking_start":
          return { slice: { ...slice, liveThinking: "", thinkingStartedAt: ctx.now }, changed: true, milestone: false };
        case "thinking_delta":
          return {
            slice: { ...slice, liveThinking: slice.liveThinking + (typeof a.delta === "string" ? a.delta : "") },
            changed: true,
            milestone: false,
          };
        case "text_start":
          return { slice: { ...slice, liveText: "" }, changed: true, milestone: false };
        case "text_delta":
          return { slice: { ...slice, liveText: slice.liveText + (typeof a.delta === "string" ? a.delta : "") }, changed: true, milestone: false };
        case "thinking_end":
        case "text_end":
        case "toolcall_end": {
          const f = flushLive(slice, ctx);
          return f.slice === slice ? same(slice) : { slice: f.slice, changed: true, milestone: false };
        }
        default:
          return same(slice);
      }
    }
    case "tool_execution_start": {
      const f = flushLive(slice, ctx);
      const item: ToolItem = {
        id: ctx.nextId(),
        kind: "tool",
        toolCallId: String(e.toolCallId ?? `t${ctx.now}`),
        name: String(e.toolName ?? "tool"),
        args: asArgs(e.args),
        status: "running",
        startedAt: ctx.now,
      };
      const next = pushItem(f.slice, item);
      return {
        slice: withUnread(
          { ...next, toolCallCount: next.toolCallCount + 1, runningToolCount: next.runningToolCount + 1 },
          true,
          ctx.visible,
        ),
        changed: true,
        milestone: true,
      };
    }
    case "tool_execution_update": {
      const text = extractText(e.partialResult);
      if (text === undefined) return same(slice);
      const next = updateTool(slice, String(e.toolCallId ?? ""), { output: text });
      return next === slice ? same(slice) : { slice: next, changed: true, milestone: false };
    }
    case "tool_execution_end": {
      const callId = String(e.toolCallId ?? "");
      const result = e.result as
        | { content?: unknown; details?: { patch?: string; diff?: string; truncation?: unknown; fullOutputPath?: string } }
        | undefined;
      const details = result?.details;
      const patch = details?.patch || details?.diff;
      const patchUpdate: Partial<ToolItem> = { status: e.isError ? "error" : "ok" };
      const running = slice.items.find((m): m is ToolItem => m.kind === "tool" && m.toolCallId === callId);
      if (running?.startedAt != null) patchUpdate.durationMs = ctx.now - running.startedAt;
      const out = extractText(result);
      if (out !== undefined) patchUpdate.output = out;
      if (patch) {
        patchUpdate.diff = patch;
        patchUpdate.diffStat = statPatch(patch);
      }
      if (details?.fullOutputPath) patchUpdate.fullOutputPath = details.fullOutputPath;
      if (details?.truncation) patchUpdate.truncated = true;
      const next = updateTool(slice, callId, patchUpdate);
      if (next === slice) return same(slice); // 对不上号的回执（如切会话后迟到的 end）整条忽略：不造里程碑、不换引用
      const named = running?.name ? String(running.name) : "工具";
      return {
        slice: withUnread({ ...next, lastMilestone: `${named} ${e.isError ? "失败" : "完成"}` }, true, ctx.visible),
        changed: true,
        milestone: true,
      };
    }
    case "turn_end": {
      const f = flushLive(slice, ctx);
      const stopReason = (e.message as { stopReason?: string } | undefined)?.stopReason;
      const next =
        stopReason === "aborted"
          ? pushItem(f.slice, { id: ctx.nextId(), kind: "system", tone: "warn", align: "start", text: "对话已终止" })
          : f.slice;
      return { slice: withUnread(next, true, ctx.visible), changed: true, milestone: true };
    }
    case "compaction_start": {
      const f = flushLive(slice, ctx);
      return {
        slice: withUnread(pushItem(f.slice, { id: ctx.nextId(), kind: "system", tone: "info", text: "正在压缩上下文…" }), true, ctx.visible),
        changed: true,
        milestone: true,
      };
    }
    case "compaction_end":
      return {
        slice: withUnread(
          pushItem(slice, {
            id: ctx.nextId(),
            kind: "system",
            tone: e.aborted ? "warn" : "info",
            text: e.aborted ? "上下文压缩已中止" : "上下文已压缩",
          }),
          true,
          ctx.visible,
        ),
        changed: true,
        milestone: true,
      };
    case "auto_retry_start":
      return {
        slice: withUnread(
          pushItem(slice, {
            id: ctx.nextId(),
            kind: "system",
            tone: "warn",
            text: `请求失败，自动重试（第 ${e.attempt ?? "?"}/${e.maxAttempts ?? "?"} 次）…`,
          }),
          true,
          ctx.visible,
        ),
        changed: true,
        milestone: true,
      };
    case "auto_retry_end":
      return {
        slice: withUnread(
          pushItem(slice, {
            id: ctx.nextId(),
            kind: "system",
            tone: e.success ? "success" : "error",
            text: e.success ? "重试成功" : `重试失败${e.finalError ? `：${String(e.finalError)}` : ""}`,
          }),
          true,
          ctx.visible,
        ),
        changed: true,
        milestone: true,
      };
    case "approval_request":
      return { slice: withUnread({ ...slice, hasPendingApproval: true }, true, ctx.visible), changed: true, milestone: true };
    case "permission_granted":
      return { slice: { ...slice, hasPendingApproval: false }, changed: true, milestone: false };
    case "queue_update":
      return {
        slice: {
          ...slice,
          queue: {
            steering: Array.isArray(e.steering) ? (e.steering as string[]) : [],
            followUp: Array.isArray(e.followUp) ? (e.followUp as string[]) : [],
          },
        },
        changed: true,
        milestone: true,
      };
    case "model_changed":
      return { slice: withUnread({ ...slice, lastMilestone: "已切换模型" }, true, ctx.visible), changed: true, milestone: true };
    case "thinking_level_changed":
      return { slice, changed: false, milestone: false };
    default:
      return same(slice);
  }
}

/** 灌一串事件（测试与「按需装载后回放增量」都用它） */
export function applyEvents(
  start: ConversationSlice,
  events: Array<Record<string, unknown>>,
  ctx: Omit<SliceCtx, "now" | "nextId"> & { now0?: number; idPrefix?: string } = {},
): ConversationSlice {
  let slice = start;
  let i = 0;
  for (const e of events) {
    i += 1;
    slice = applyEngineEvent(slice, e, {
      now: (ctx.now0 ?? 0) + i,
      nextId: () => `${ctx.idPrefix ?? "m"}${i}`,
      visible: ctx.visible,
    }).slice;
  }
  return slice;
}
