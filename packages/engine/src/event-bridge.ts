import { EngineEventSchema, type EngineEvent } from "@pi-wood/ipc-schema";

/**
 * 事件归一化桥（T1.1）：
 * Pi SDK 原始事件 → EngineEvent。合法事件原样通过（保留未知字段）；
 * 未知/畸形事件归一化为 { type:"unknown", originalType } 并告警，绝不抛出——
 * 这是 Pi 版本升级时桌面端的前向兼容防线（执行计划 §8 / R-3）。
 */
export function normalizeEngineEvent(raw: unknown, warn?: (msg: string) => void): EngineEvent {
  const parsed = EngineEventSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const originalType =
    typeof raw === "object" && raw !== null && typeof (raw as { type?: unknown }).type === "string"
      ? ((raw as { type: string }).type as string)
      : "non-object-event";
  warn?.(`[event-bridge] 未识别的引擎事件 type="${originalType}"，已按 unknown 透传`);
  return { type: "unknown", originalType };
}
