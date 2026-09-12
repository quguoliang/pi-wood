import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GoalState } from "@pi-wood/ipc-schema";

/**
 * T7.5 目标持久化（~/.pi-wood/goals/）。目标正文存 `<id>.md`（可中途编辑、tick 时实时重读），
 * 状态存 `<id>.state.json`。会话 metadata 不承载大文本正文（防膨胀 + 防注入，见 §8）。
 */

const slug = (id: string): string => id.replace(/[^a-z0-9._-]/gi, "_").slice(0, 120) || "goal";

export function goalsDir(appDataDir: string): string {
  const dir = join(appDataDir, "goals");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function objectivePath(dir: string, id: string): string {
  return join(dir, `${slug(id)}.md`);
}
function statePath(dir: string, id: string): string {
  return join(dir, `${slug(id)}.state.json`);
}

export function writeObjective(dir: string, id: string, text: string): void {
  writeFileSync(objectivePath(dir, id), text, "utf-8");
}

export function readObjective(dir: string, id: string): string | null {
  const p = objectivePath(dir, id);
  return existsSync(p) ? readFileSync(p, "utf-8") : null;
}

export function writeGoalState(dir: string, state: GoalState): void {
  writeFileSync(statePath(dir, state.sessionId), JSON.stringify(state), "utf-8");
}

/** 状态文件的最小完整性校验（坏文件／旧格式一律当不存在，不抛）。 */
function parseGoalState(raw: string): GoalState | null {
  try {
    const parsed = JSON.parse(raw) as GoalState;
    if (!parsed || typeof parsed !== "object") return null;
    return typeof parsed.sessionId === "string" && typeof parsed.status === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function readGoalState(dir: string, id: string): GoalState | null {
  const p = statePath(dir, id);
  if (!existsSync(p)) return null;
  try {
    return parseGoalState(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * 全量读取 goalsDir 下的所有目标状态（启动预热用）。
 * 必须能读到「本次进程从未 load 过」的目标——否则 T8.5 的 goal 互斥在应用重启后
 * 对落盘遗留的 active 目标失明，落盘层可并存两个 active（成本乘积失控）。
 * 目录不存在／坏文件／读取竞态一律跳过且不抛：预热是旁路，不得阻断启动。
 */
export function readAllGoalStates(dir: string): GoalState[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: GoalState[] = [];
  for (const name of names) {
    if (!name.endsWith(".state.json")) continue;
    try {
      const st = parseGoalState(readFileSync(join(dir, name), "utf-8"));
      if (st) out.push(st);
    } catch {
      /* 读取竞态：跳过 */
    }
  }
  return out;
}

export function clearGoal(dir: string, id: string): void {
  for (const p of [objectivePath(dir, id), statePath(dir, id)]) {
    try {
      rmSync(p, { force: true });
    } catch {
      /* 不存在忽略 */
    }
  }
}
