import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ipcMain } from "electron";
import {
  SUBAGENT_CHANNELS,
  ToolPermissionActionSchema,
  type SubagentProfileInfo,
} from "@pi-wood/ipc-schema";
import { getSettings, replaceSection } from "../settings-service.ts";
import {
  buildProfiles,
  clearAgentPermissions,
  extractDescription,
  profileNameFromFile,
  setToolPermission,
  type PermAction,
  type PermMap,
} from "./permissions.ts";

/** 扫 agents 目录：`<name>.md` → { name, description? }（description 从 frontmatter 提）。 */
function scanProfiles(agentsDir: string): Array<{ name: string; description?: string }> {
  if (!existsSync(agentsDir)) return [];
  const out: Array<{ name: string; description?: string }> = [];
  let names: string[] = [];
  try {
    names = readdirSync(agentsDir);
  } catch {
    return out;
  }
  for (const f of names) {
    if (!/\.(md|markdown)$/i.test(f)) continue;
    let description: string | undefined;
    try {
      description = extractDescription(readFileSync(join(agentsDir, f), "utf-8"));
    } catch {
      /* 读不到就仅给名字 */
    }
    out.push({ name: profileNameFromFile(f), description });
  }
  return out;
}

function currentMap(): PermMap {
  return (getSettings().subagentPermissions ?? {}) as PermMap;
}

function snapshot(agentsDir: string): SubagentProfileInfo[] {
  return buildProfiles(scanProfiles(agentsDir), currentMap());
}

/**
 * T6.7 子代理 per-tool 权限设置页后端：枚举 profile（agents 目录 ∪ 已配置）、
 * 写/清 settings.subagentPermissions（整段替换以支持删除键）。engine-manager 的 child guard
 * 按 agent 名查该表覆盖审批门。
 */
export function initSubagentPermissionsIpc(agentsDir: string): void {
  ipcMain.handle(SUBAGENT_CHANNELS.listProfiles, (): SubagentProfileInfo[] => snapshot(agentsDir));

  ipcMain.handle(SUBAGENT_CHANNELS.setPermission, (_e, raw: unknown): SubagentProfileInfo[] => {
    const arg = (raw ?? {}) as { agent?: unknown; tool?: unknown; action?: unknown };
    const agent = typeof arg.agent === "string" ? arg.agent : undefined;
    const tool = typeof arg.tool === "string" ? arg.tool : undefined;
    if (agent && tool) {
      let action: PermAction = "inherit";
      if (arg.action === "inherit" || arg.action == null) action = "inherit";
      else {
        const parsed = ToolPermissionActionSchema.safeParse(arg.action);
        if (parsed.success) action = parsed.data;
      }
      replaceSection("subagentPermissions", setToolPermission(currentMap(), agent, tool, action));
    }
    return snapshot(agentsDir);
  });

  ipcMain.handle(SUBAGENT_CHANNELS.clearPermissions, (_e, raw: unknown): SubagentProfileInfo[] => {
    const agent = (raw as { agent?: unknown } | undefined)?.agent;
    if (typeof agent === "string") {
      replaceSection("subagentPermissions", clearAgentPermissions(currentMap(), agent));
    }
    return snapshot(agentsDir);
  });
}
