/**
 * T7.8 定时任务：纯函数核（无 electron/fs 依赖，可单测）。
 * - cron 表达式解析与下次运行时间计算（标准 5 段：分 时 日 月 周）
 * - loop 文件 frontmatter 解析/序列化（Markdown body = prompt）
 * - 运行状态记录与任务字段规整
 */

export interface CronSpec {
  minute: number[]; // 0-59
  hour: number[]; // 0-23
  dayOfMonth: number[]; // 1-31
  month: number[]; // 1-12
  dayOfWeek: number[]; // 0-6（0=周日）
}

export interface LoopDefinition {
  name: string;
  schedule: string; // cron 表达式
  enabled: boolean;
  model?: string; // "provider/model"
  agent?: string;
  timezone?: string; // IANA，如 "Asia/Shanghai"；缺省用系统本地时区
  prompt: string; // markdown body
}

export type ScheduledRunStatus = "ok" | "error" | "skipped";

export interface ScheduledRunRecord {
  lastRunAt?: number;
  nextRunAt?: number;
  lastStatus?: ScheduledRunStatus;
  lastError?: string;
  lastSessionId?: string;
  lastDurationMs?: number;
  /** occurrence claiming：本次已认领的触发时刻（跨实例防双开） */
  lastScheduledFor?: number;
}

export interface ScheduledTask extends LoopDefinition {
  id: string;
  /** "file" = loop 文件来源（编辑走 loop 文件）；"manual" = 管理页创建 */
  source: "file" | "manual";
  /** loop 文件绝对路径（source=file 时存在） */
  filePath?: string;
  projectDir?: string; // 项目 scope；缺省=用户 scope
  run: ScheduledRunRecord;
}

// ---------- cron ----------

const FIELD_RANGES: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // dayOfMonth
  [1, 12], // month
  [0, 6], // dayOfWeek
];

function parseField(field: string, lo: number, hi: number): number[] | null {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const p = part.trim();
    if (!p) return null;
    // step: */n 或 a-b/n 或 a/n（a 起每 n）
    const [rangePart, stepPart] = p.split("/");
    const step = stepPart !== undefined ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) return null;
    let rLo: number;
    let rHi: number;
    if (rangePart === "*" || rangePart === "") {
      rLo = lo;
      rHi = hi;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-").map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < lo || b > hi || a > b) return null;
      rLo = a;
      rHi = b;
    } else {
      const a = Number(rangePart);
      // dayOfWeek 段允许 7（周日，归一在 parseCron 做）
      const hiAllow = lo === 0 && hi === 6 ? 7 : hi;
      if (!Number.isInteger(a) || a < lo || a > hiAllow) return null;
      rLo = a;
      rHi = stepPart !== undefined ? hi : a; // "5/10" = 从 5 到顶
    }
    for (let v = rLo; v <= rHi; v += step) out.add(v);
  }
  if (out.size === 0) return null;
  return [...out].sort((x, y) => x - y);
}

/** 解析 5 段 cron；非法返回 null。dayOfWeek 接受 7=周日（归一为 0）。 */
export function parseCron(expr: string): CronSpec | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const spec: CronSpec = { minute: [], hour: [], dayOfMonth: [], month: [], dayOfWeek: [] };
  const keys: Array<keyof CronSpec> = ["minute", "hour", "dayOfMonth", "month", "dayOfWeek"];
  for (let i = 0; i < 5; i++) {
    const vals = parseField(fields[i], FIELD_RANGES[i][0], FIELD_RANGES[i][1]);
    if (!vals) return null;
    if (keys[i] === "dayOfWeek") {
      const norm = vals.map((v) => (v === 7 ? 0 : v));
      spec.dayOfWeek = [...new Set(norm)].sort((a, b) => a - b);
    } else {
      spec[keys[i]] = vals;
    }
  }
  return spec;
}

/**
 * 计算 from（毫秒，不含）之后下一次触发时刻。按分钟粒度向前扫描，上限 4 年。
 * dayOfMonth 与 dayOfWeek 均为 "*" 时取并集语义之外的常用约定：
 *   - 两者都受限 → 满足其一即可（Vixie cron 语义）
 *   - 任一 "*" → 受限者说了算
 */
export function nextRun(spec: CronSpec, from: number): number | null {
  const start = Math.floor(from / 60000) * 60000 + 60000; // 下一分钟整
  const limit = start + 4 * 366 * 24 * 60 * 60000;
  const domRestricted = spec.dayOfMonth.length < 31;
  const dowRestricted = spec.dayOfWeek.length < 7;
  for (let t = start; t <= limit; t += 60000) {
    const d = new Date(t);
    if (!spec.minute.includes(d.getMinutes())) continue;
    if (!spec.hour.includes(d.getHours())) continue;
    if (!spec.month.includes(d.getMonth() + 1)) continue;
    const domOk = spec.dayOfMonth.includes(d.getDate());
    const dowOk = spec.dayOfWeek.includes(d.getDay());
    const dayOk =
      domRestricted && dowRestricted ? domOk || dowOk : domRestricted ? domOk : dowRestricted ? dowOk : true;
    if (dayOk) return t;
  }
  return null;
}

// ---------- frontmatter ----------

/** 解析 loop 文件：`---\nkey: value\n---\nbody`。缺 name/schedule → null；解析失败行忽略。 */
export function parseLoopFile(text: string): LoopDefinition | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) fm[kv[1].toLowerCase()] = kv[2].trim();
  }
  const name = fm["name"];
  const schedule = fm["schedule"];
  if (!name || !schedule || !parseCron(schedule)) return null;
  return {
    name,
    schedule,
    enabled: fm["enabled"] !== "false",
    model: fm["model"] || undefined,
    agent: fm["agent"] || undefined,
    timezone: fm["timezone"] || undefined,
    prompt: m[2].trim(),
  };
}

export function serializeLoopFile(def: LoopDefinition): string {
  const lines = ["---", `name: ${def.name}`, `schedule: ${def.schedule}`, `enabled: ${def.enabled ? "true" : "false"}`];
  if (def.model) lines.push(`model: ${def.model}`);
  if (def.agent) lines.push(`agent: ${def.agent}`);
  if (def.timezone) lines.push(`timezone: ${def.timezone}`);
  lines.push("---", "", def.prompt, "");
  return lines.join("\n");
}

// ---------- 任务规整/状态 ----------

let idCounter = 0;
/** 生成任务 id：文件源用路径 slug（稳定，reconcile 可对账），manual 用时间戳+序号。 */
export function taskIdFor(source: "file" | "manual", key: string): string {
  if (source === "file") {
    return "file:" + key.replace(/[^a-z0-9._-]/gi, "_").slice(-100);
  }
  return `manual:${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

/** 状态迁移：一次触发完成后写回 run 记录。 */
export function recordRun(
  prev: ScheduledRunRecord,
  result: { ok: boolean; error?: string; sessionId?: string; durationMs?: number; ranAt: number; nextAt: number | null },
): ScheduledRunRecord {
  return {
    ...prev,
    lastRunAt: result.ranAt,
    nextRunAt: result.nextAt ?? undefined,
    lastStatus: result.ok ? "ok" : "error",
    lastError: result.ok ? undefined : (result.error ?? "unknown"),
    lastSessionId: result.sessionId,
    lastDurationMs: result.durationMs,
  };
}

/** occurrence claiming：能否认领 nextAt 这次触发（防双开）。 */
export function canClaim(run: ScheduledRunRecord, occurrenceAt: number): boolean {
  return run.lastScheduledFor !== occurrenceAt;
}

/** 规整手动创建任务的输入：返回错误或干净定义。 */
export function validateDefinition(def: LoopDefinition): string | null {
  if (!def.name.trim()) return "名称不能为空";
  if (!parseCron(def.schedule)) return "cron 表达式非法（须为 5 段：分 时 日 月 周）";
  if (!def.prompt.trim()) return "prompt 不能为空";
  if (def.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: def.timezone });
    } catch {
      return `时区非法：${def.timezone}`;
    }
  }
  return null;
}
