/**
 * 出站事件节流（T8.3 性能主战场的机制层）
 *
 * 现状核实里那条「每 text_delta 一条 IPC + 一次 zustand set」在多对话下是 N 倍放大：
 * 三路并发流式时，用户只看得见的 active 对话值得逐 token 渲染，**后台对话的 token 是纯浪费**
 * ——既烧 IPC 通道，又逼渲染层做无意义 diff。所以：
 *
 * - active 对话：全部原样透传（体感优先）。
 * - 后台对话：只合并**增量类**事件（`message_update` 的 delta、`tool_execution_update`、
 *   `bash_execution_update`），按 `maxWaitMs`（默认 200ms）或 `maxBytes`（默认 4KB）到点合帧；
 *   **里程碑**（回合起止、工具起止、审批、队列、模型切换…）永远立刻透传——
 *   它们是标签摘要与「有活干完了」的唯一信号，压掉就等于对用户撒谎。
 *
 * 设计约束：
 * 1. 纯：时间/大小阈值都从参数注入 ⇒ 可在 `node --test` 里确定性穷举（性能红线表「事件流量」
 *    那一行的机制判据就在这份单测里，真机三路并发的条数由 `--conversation-probe` 复算）。
 * 2. 合并只动 delta，不动语义：`text_delta` 与 `thinking_delta` 不互相合并，
 *    不同 `toolCallId` 的 update 不互相合并（否则会把两个工具的输出糊成一坨）。
 * 3. **顺序不变量**：里程碑发出前必须先把该对话缓冲里的增量按原顺序冲出去，
 *    否则渲染层会先看到「工具结束」再看到它前面的 token ⇒ 内容错序。
 * 4. 丢帧不许静默：合并计数（`merged`）随快照上报，渲染层/探针都能看出「这里被合过」。
 */

/** 可合并的增量类事件（其余一律视为里程碑） */
export const COALESCABLE_EVENT_TYPES: readonly string[] = [
  "message_update",
  "tool_execution_update",
  "bash_execution_update",
];

/**
 * 默认阈值。
 *
 * ⚠ 计划原写「200ms 或 4KB」，实测不成立：一条 `text_delta` 帧约 90B，1000 token/秒
 * ⇒ 每个 200ms 窗口约 18KB，4KB 阈值会在窗口内反复触发提前出帧（实测 ≈22 帧/秒），
 * 直接破「后台对话 IPC ≤6 条/秒/对话」红线。所以字节阈值只当**突发大输出的兜底**
 * （bash 长输出那种），常规切窗交给时间轴；32KB ≈ 1000 token/秒时永不抢在 200ms 之前。
 */
export const DEFAULT_THROTTLE = { maxWaitMs: 200, maxBytes: 32 * 1024 };

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** 事件字节数估算（合帧阈值的度量口径：JSON 长度，够单调且不需要编码整帧） */
export function eventBytes(event: unknown): number {
  try {
    return JSON.stringify(event)?.length ?? 0;
  } catch {
    return String(event ?? "").length;
  }
}

/**
 * 合并键：只有同键的增量才能并成一条。
 * null = 不可合并（里程碑，必须原样到）。
 */
export function coalesceKey(event: unknown): string | null {
  const e = asRecord(event);
  const type = typeof e.type === "string" ? e.type : "";
  if (!COALESCABLE_EVENT_TYPES.includes(type)) return null;
  if (type === "message_update") {
    const a = asRecord(e.assistantMessageEvent);
    const sub = typeof a.type === "string" ? a.type : "?";
    if (!sub.endsWith("_delta")) return null; // text_start/text_end 等边界事件必须原样到（它们决定尾巴何时落地）
    const id = typeof e.messageId === "string" ? e.messageId : typeof e.uuid === "string" ? e.uuid : "-";
    return `mu:${id}:${sub}`;
  }
  if (type === "tool_execution_update") return `teu:${typeof e.toolCallId === "string" ? e.toolCallId : "-"}`;
  return `beu:${typeof e.id === "string" ? e.id : "-"}`;
}

/** 把 incoming 合进 buffered；返回 null 表示不可合并（调用方先冲缓冲再直发 incoming） */
export function mergeCoalescable(
  buffered: unknown,
  incoming: unknown,
): Record<string, unknown> | null {
  const key = coalesceKey(incoming);
  if (key === null || coalesceKey(buffered) !== key) return null;
  const b = asRecord(buffered);
  const n = asRecord(incoming);
  if (b.type === "message_update") {
    const ba = asRecord(b.assistantMessageEvent);
    const na = asRecord(n.assistantMessageEvent);
    const delta = `${typeof ba.delta === "string" ? ba.delta : ""}${typeof na.delta === "string" ? na.delta : ""}`;
    return { ...n, assistantMessageEvent: { ...na, ...ba, delta } };
  }
  // tool/bash 的 update 载荷是「累计值」语义（partialResult / 最新 output）⇒ 取最新，不拼接
  return { ...n };
}

export interface ThrottleOptions {
  /** 合帧最长等待（毫秒） */
  maxWaitMs?: number;
  /** 合帧最大字节（估算）阈值 */
  maxBytes?: number;
}

export interface ThrottledFrame {
  event: Record<string, unknown>;
  /** 这一帧里被合掉的原始事件条数（0 = 原样透传） */
  merged: number;
  /** 合帧时取「最新一条」的 child 帧号（渲染层对账用；单条透传时就是它自己） */
  seq?: number;
}

export interface OutboundThrottle {
  /** 入队一条事件；返回应当立刻发出的帧数组（里程碑 → 先冲缓冲再发它自己；增量 → 通常 0 帧，到点批量出） */
  push(event: Record<string, unknown>, visible: boolean, seq?: number): ThrottledFrame[];
  /** 定时器到点：把攒着的帧吐出去 */
  tick(): ThrottledFrame[];
  /** 强制清空（回合结束 / 切前台 / 关窗时用，保证不吞尾巴） */
  flush(): ThrottledFrame[];
  stats(): { in: number; out: number; merged: number; pending: number };
}

interface BufferEntry {
  event: Record<string, unknown>;
  merged: number;
  seq?: number;
  bytes: number;
  since: number;
}

/**
 * 每对话一个实例（后台对话各自攒各自的帧，互不干扰）。
 * `visible=true`（用户正看着）时完全旁路合并——体感优先，且避免切回来发现尾巴缺一段。
 */
export function createOutboundThrottle(opts: ThrottleOptions = {}): OutboundThrottle {
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_THROTTLE.maxWaitMs;
  const maxBytes = opts.maxBytes ?? DEFAULT_THROTTLE.maxBytes;
  const pending = new Map<string, BufferEntry>();
  let inCount = 0;
  let outCount = 0;
  let mergedCount = 0;
  let clock = 0;

  const take = (entry: BufferEntry): ThrottledFrame => {
    outCount += 1;
    mergedCount += entry.merged;
    return { event: entry.event, merged: entry.merged, ...(entry.seq !== undefined ? { seq: entry.seq } : {}) };
  };

  const drain = (pred: (entry: BufferEntry, age: number) => boolean): ThrottledFrame[] => {
    const ready: ThrottledFrame[] = [];
    for (const [key, entry] of [...pending.entries()]) {
      if (!pred(entry, clock - entry.since)) continue;
      pending.delete(key);
      ready.push(take(entry));
    }
    return ready;
  };

  const drainDue = () => drain((entry, age) => entry.bytes >= maxBytes || age >= maxWaitMs);

  return {
    push(event, visible, seq) {
      inCount += 1;
      const key = visible ? null : coalesceKey(event);
      if (key === null) {
        // 里程碑（或该对话正被看着）：先按原顺序冲掉缓冲，再直发这一条
        const buffered = drain(() => true);
        outCount += 1;
        return [...buffered, { event, merged: 0, ...(seq !== undefined ? { seq } : {}) }];
      }
      const existing = pending.get(key);
      if (!existing) {
        pending.set(key, { event, merged: 0, seq, bytes: eventBytes(event), since: clock });
        return [];
      }
      const merged = mergeCoalescable(existing.event, event);
      if (!merged) {
        // 同键但合不动（罕见）：立刻把旧帧发出、新事件重新入队——绝不吞帧也不改序
        pending.delete(key);
        pending.set(key, { event, merged: 0, seq, bytes: eventBytes(event), since: clock });
        return [take(existing), ...drainDue()];
      }
      pending.set(key, {
        event: merged,
        merged: existing.merged + 1,
        seq: seq ?? existing.seq,
        bytes: existing.bytes + eventBytes(event),
        since: existing.since,
      });
      return drainDue();
    },
    tick() {
      clock += maxWaitMs;
      return drain(() => true);
    },
    flush() {
      return drain(() => true);
    },
    stats() {
      return { in: inCount, out: outCount, merged: mergedCount, pending: pending.size };
    },
  };
}
