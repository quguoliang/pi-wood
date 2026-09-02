import type { AttachmentItem } from "../hooks/use-composer-controller";

/**
 * T7.11 会话草稿持久化。按 sessionId 暂存 Composer 的输入文本 + 附件，切换会话/刷新不丢，
 * 发送后清除。存储用渲染层 localStorage（`pi-wood.chatDrafts.v1`，versioned envelope，LRU 上限）。
 *
 * 纯逻辑（合并/裁剪/序列化）与 localStorage IO 分离，前者可在无 DOM 环境直接单测。
 */

export const DRAFT_STORAGE_KEY = "pi-wood.chatDrafts.v1";
export const DRAFT_VERSION = 1;
export const MAX_DRAFTS = 50;

export interface DraftEntry {
  text: string;
  attachments: AttachmentItem[];
  touchedAt: number;
}
export type DraftMap = Record<string, DraftEntry>;

interface Envelope {
  version: number;
  drafts: DraftMap;
}

function isValidEntry(v: unknown): v is DraftEntry {
  const e = v as DraftEntry | undefined;
  return !!e && typeof e.text === "string" && Array.isArray(e.attachments) && typeof e.touchedAt === "number";
}

/** 解析存储串：缺失/坏 JSON/版本不符 → 空表（降级，不崩）。 */
export function parseDrafts(raw: string | null): DraftMap {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Partial<Envelope>;
    if (!obj || obj.version !== DRAFT_VERSION || typeof obj.drafts !== "object" || obj.drafts === null) return {};
    const out: DraftMap = {};
    for (const [k, v] of Object.entries(obj.drafts)) if (isValidEntry(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function serializeDrafts(map: DraftMap): string {
  return JSON.stringify({ version: DRAFT_VERSION, drafts: map } satisfies Envelope);
}

/**
 * 写入/更新某会话草稿；空文本且无附件 → 视为清除该会话条目。
 * 超过 max 时按 touchedAt 淘汰最旧（不含刚写入者）。返回新表（不可变）。
 */
export function upsertDraft(
  map: DraftMap,
  key: string,
  snapshot: { text: string; attachments: AttachmentItem[] },
  touchedAt: number,
  max = MAX_DRAFTS,
): DraftMap {
  const next: DraftMap = { ...map };
  const isEmpty = snapshot.text.trim() === "" && snapshot.attachments.length === 0;
  if (isEmpty) {
    delete next[key];
    return next;
  }
  next[key] = { text: snapshot.text, attachments: snapshot.attachments, touchedAt };
  const keys = Object.keys(next);
  if (keys.length > max) {
    const victims = keys
      .filter((k) => k !== key)
      .sort((a, b) => next[a].touchedAt - next[b].touchedAt)
      .slice(0, keys.length - max);
    for (const v of victims) delete next[v];
  }
  return next;
}

export function removeDraft(map: DraftMap, key: string): DraftMap {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

// ---------- localStorage IO（仅在浏览器/Electron 渲染层调用，SSR/node 单测下自动降级为 no-op） ----------

const hasStorage = (): boolean => typeof localStorage !== "undefined" && localStorage !== null;

let memoryFallback: string | null = null; // 无 localStorage 时（测试/异常）的内存兜底

export function loadDrafts(): DraftMap {
  if (!hasStorage()) return parseDrafts(memoryFallback);
  try {
    return parseDrafts(localStorage.getItem(DRAFT_STORAGE_KEY));
  } catch {
    return {};
  }
}

export function saveDrafts(map: DraftMap): void {
  const raw = serializeDrafts(map);
  if (!hasStorage()) {
    memoryFallback = raw;
    return;
  }
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, raw);
  } catch {
    /* 配额/隐私模式：忽略 */
  }
}

/** 读某会话草稿（undefined = 无草稿）。 */
export function readDraft(key: string): DraftEntry | undefined {
  return loadDrafts()[key];
}

/** 写/清某会话草稿，返回落库后的整表。 */
export function writeDraft(key: string, snapshot: { text: string; attachments: AttachmentItem[] }): DraftMap {
  const next = upsertDraft(loadDrafts(), key, snapshot, Date.now());
  saveDrafts(next);
  return next;
}

export function clearDraft(key: string): void {
  saveDrafts(removeDraft(loadDrafts(), key));
}
