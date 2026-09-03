import { ipcMain } from "electron";
import { join } from "node:path";
import { GOAL_CHANNELS, type GoalState } from "@pi-wood/ipc-schema";
import { getActiveAdapter } from "../engine/engine-manager.ts";
import {
  beginGoal,
  clearGoalFor,
  configureGoalRuntime,
  getGoalState,
  pauseGoal,
  resumeGoal,
  updateObjective,
} from "./goal-runtime.ts";

/** 与 settings-service 同源的 ~/.pi-wood 数据目录。 */
function appDataDir(): string {
  return join(process.env["USERPROFILE"] ?? process.env["HOME"] ?? ".", ".pi-wood");
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const numOr = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/**
 * T7.5 目标模式 IPC：渲染层设/取/暂停/恢复/清除目标；begin 时读真 adapter 累计 token 作 baseline，
 * 并把 kickoff prompt 发到主会话开跑。状态变更经 goal-runtime 的 sendToRenderer 推 `goal:status`。
 */
export function initGoalIpc(sendToRenderer: (channel: string, data: unknown) => void): void {
  configureGoalRuntime({ appDataDir: appDataDir(), sendToRenderer });

  ipcMain.handle(GOAL_CHANNELS.get, (_e, raw: unknown): GoalState | null => {
    const sessionId = str((raw as { sessionId?: unknown })?.sessionId);
    return sessionId ? getGoalState(sessionId) : null;
  });

  ipcMain.handle(GOAL_CHANNELS.set, async (_e, raw: unknown): Promise<GoalState | null> => {
    const arg = (raw ?? {}) as { sessionId?: unknown; objective?: unknown; tokenBudget?: unknown; maxTurns?: unknown };
    const adapter = getActiveAdapter();
    const sessionId = str(arg.sessionId) || (adapter?.getSessionId?.() ?? "");
    const objective = str(arg.objective).trim();
    if (!sessionId || !objective) return sessionId ? getGoalState(sessionId) : null;
    // baseline：目标开启前会话已消耗的累计 token，避免把历史计入目标预算
    let initialTotalTokens = 0;
    let initialCostUsd = 0;
    try {
      const ri = await adapter?.getRuntimeInfo?.();
      initialTotalTokens = ri?.stats?.tokens?.total ?? 0;
      initialCostUsd = ri?.stats?.cost ?? 0;
    } catch {
      /* 读不到按 0 */
    }
    const { state, kickoff } = beginGoal(sessionId, objective, {
      tokenBudget: numOr(arg.tokenBudget, 0) || undefined,
      maxTurns: numOr(arg.maxTurns, 0) || undefined,
      initialTotalTokens,
      initialCostUsd,
    });
    try {
      await adapter?.prompt({ text: kickoff });
    } catch {
      /* kickoff 发送失败：状态已建，用户可再触发 */
    }
    return state;
  });

  ipcMain.handle(GOAL_CHANNELS.pause, (_e, raw: unknown): GoalState | null => pauseGoal(str((raw as { sessionId?: unknown })?.sessionId)));
  ipcMain.handle(GOAL_CHANNELS.resume, (_e, raw: unknown): GoalState | null => resumeGoal(str((raw as { sessionId?: unknown })?.sessionId)));
  ipcMain.handle(GOAL_CHANNELS.clear, (_e, raw: unknown): null => {
    clearGoalFor(str((raw as { sessionId?: unknown })?.sessionId));
    return null;
  });
  ipcMain.handle(GOAL_CHANNELS.updateObjective, (_e, raw: unknown): GoalState | null => {
    const arg = (raw ?? {}) as { sessionId?: unknown; objective?: unknown };
    const sessionId = str(arg.sessionId);
    if (sessionId) updateObjective(sessionId, str(arg.objective));
    return sessionId ? getGoalState(sessionId) : null;
  });
}
