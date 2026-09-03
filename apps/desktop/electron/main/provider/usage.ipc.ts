import { join } from "node:path";
import { ipcMain } from "electron";
import { ENGINE_CHANNELS, type UsageView } from "@pi-wood/ipc-schema";
import { configureUsageTracker, getUsageTracker } from "./usage-tracker.ts";
import { loadSettings } from "../settings-service.ts";

function appDataDir(): string {
  return join(process.env["USERPROFILE"] ?? process.env["HOME"] ?? ".", ".pi-wood");
}

/**
 * T7.12 用量追踪接线：配置 UsageTracker 单例（月度文件落 ~/.pi-wood/usage），注册 engine:getUsage
 * 供设置用量页/环境面板拉取。写侧由 engine-manager 在 agent_settled 调 recordUsage。
 */
export function initUsageTracking(): void {
  configureUsageTracker({
    appDataDir: appDataDir(),
    now: () => Date.now(),
    getQuota: () => loadSettings().quota ?? {},
  });

  ipcMain.handle(ENGINE_CHANNELS.getUsage, (_e, raw: unknown): UsageView | null => {
    const tracker = getUsageTracker();
    if (!tracker) return null;
    const month = typeof (raw as { month?: unknown } | undefined)?.month === "string" ? (raw as { month: string }).month : undefined;
    return tracker.readUsage(month);
  });
}
