import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

export function readGoalState(dir: string, id: string): GoalState | null {
  const p = statePath(dir, id);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf-8")) as GoalState;
    return typeof parsed.sessionId === "string" && typeof parsed.status === "string" ? parsed : null;
  } catch {
    return null;
  }
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
