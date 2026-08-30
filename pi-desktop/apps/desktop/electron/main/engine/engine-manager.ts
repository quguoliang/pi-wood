import { ipcMain, BrowserWindow, dialog } from "electron";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { ENGINE_CHANNELS, PromptCommandSchema } from "@pidesk/ipc-schema";
import { SdkAdapter } from "@pidesk/engine/sdk";
import type { DesktopUiBridge } from "@pidesk/engine";
import { SnapshotService } from "../workbench/snapshot-service";
import { browserCustomTools } from "../agent-tools/browser-tools";

/**
 * 引擎管理器（T1.3）：主进程持有当前项目的 SdkAdapter 单例。
 * 事件统一经 ENGINE_CHANNELS.event 推送渲染层；ctx.ui 的 notify 转发渲染层，
 * 阻塞式对话框（select/confirm/input）T2.x 接 Radix 时在此挂起 Promise。
 */

const StartArgSchema = z.object({ projectDir: z.string().min(1) });
const TextArgSchema = z.object({ text: z.string().min(1) });
const SetModelArgSchema = z.object({ provider: z.string(), modelId: z.string() });

let adapter: SdkAdapter | undefined;
let activeProject = "";

function send(channel: string, data: unknown): void {
  const win = BrowserWindow.getAllWindows()[0];
  win?.webContents.send(channel, data);
}

function uiBridge(): DesktopUiBridge {
  return {
    notify: (message, type) => send("ui:notify", { message, type: type ?? "info" }),
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
  };
}

export async function ensureEngine(projectDir: string): Promise<SdkAdapter> {
  if (adapter && activeProject === projectDir) return adapter;
  if (adapter) await adapter.stop();
  const next = new SdkAdapter();
  await next.start({
    projectDir,
    uiBridge: uiBridge(),
    customTools: browserCustomTools(),
  });
  const snapshots = new SnapshotService(projectDir, (m) => console.warn(m));
  next.subscribe((event) => {
    send(ENGINE_CHANNELS.event, event);
    // T2.2：edit/write 前后快照 → diff 推送右栏（含相对路径解析）
    if (event.type === "tool_execution_start") {
      snapshots.snapshot(String(event.toolName ?? ""), event.input);
    }
    if (event.type === "tool_execution_end" && (event.toolName === "edit" || event.toolName === "write")) {
      for (const d of snapshots.collectPatches()) send(ENGINE_CHANNELS.diff, d);
    }
  });
  // 默认模型：chat 优先、v4 兜底（目录随在线刷新变化，见 §8；正式模型 UI 在 T3.2）
  try {
    const models = await next.getAvailableModels();
    const candidates: Array<[string, string]> = [
      ["deepseek", "deepseek-chat"],
      ["deepseek", "deepseek-v4-flash"],
      ["deepseek", "deepseek-v4-pro"],
    ];
    for (const [provider, id] of candidates) {
      if (models.some((m) => m.provider === provider && m.id === id)) {
        await next.setModel(provider, id);
        break;
      }
    }
  } catch (err) {
    send("ui:notify", { message: `默认模型选择失败: ${String(err)}`, type: "warning" });
  }
  adapter = next;
  activeProject = projectDir;
  return next;
}

export function getActiveAdapter(): SdkAdapter | undefined {
  return adapter;
}

export function getActiveProjectDir(): string {
  if (!activeProject) throw new Error("引擎未启动：请先选择项目");
  return activeProject;
}

async function requireAdapter(): Promise<SdkAdapter> {
  if (!adapter) throw new Error("引擎未启动：请先选择项目");
  return adapter;
}

/** T2.2：diff 快照逻辑已迁至 workbench/snapshot-service.ts */

export function initEngineIpc(): void {
  ipcMain.handle("engine:switchSession", async (_e, raw: unknown) => {
    const { file } = z.object({ file: z.string().min(1) }).parse(raw);
    await (await requireAdapter()).switchSession(file);
    return true;
  });
  // ---- T1.3 压测钩子：注入 N 条消息事件验证虚拟列表（保留为 dev 工具）----
  ipcMain.handle("debug:stress", async (_e, raw: unknown) => {
    const { count } = z.object({ count: z.number().int().min(1).max(50000) }).parse(raw);
    for (let i = 0; i < count; i++) {
      send(ENGINE_CHANNELS.event, { type: "user_message", text: `压测消息 #${i + 1}` });
    }
    return count;
  });
  // ---- T1.5 门禁：窗口截图留证 ----
  ipcMain.handle("debug:capture", async (_e, raw: unknown) => {
    const { file } = z.object({ file: z.string().min(1) }).parse(raw);
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return false;
    const image = await win.webContents.capturePage();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, image.toPNG());
    return true;
  });

  ipcMain.handle("engine:start", async (_e, raw: unknown) => {
    const { projectDir } = StartArgSchema.parse(raw);
    await ensureEngine(projectDir);
    return true;
  });

  ipcMain.removeHandler(ENGINE_CHANNELS.prompt);
  ipcMain.handle(ENGINE_CHANNELS.prompt, async (_e, raw: unknown) => {
    const cmd = PromptCommandSchema.parse(raw);
    const a = await requireAdapter();
    send(ENGINE_CHANNELS.event, { type: "user_message", text: cmd.text });
    await a.prompt(cmd);
  });

  ipcMain.handle("engine:steer", async (_e, raw: unknown) => {
    const { text } = TextArgSchema.parse(raw);
    await (await requireAdapter()).steer(text);
  });

  ipcMain.handle("engine:followUp", async (_e, raw: unknown) => {
    const { text } = TextArgSchema.parse(raw);
    await (await requireAdapter()).followUp(text);
  });

  ipcMain.handle("engine:abort", async () => {
    await (await requireAdapter()).abort();
  });

  ipcMain.handle("engine:setModel", async (_e, raw: unknown) => {
    const { provider, modelId } = SetModelArgSchema.parse(raw);
    await (await requireAdapter()).setModel(provider, modelId);
  });

  ipcMain.handle("engine:getAvailableModels", async () => {
    return (await requireAdapter()).getAvailableModels();
  });

  ipcMain.handle("engine:getState", async () => {
    return (await requireAdapter()).getState();
  });

  ipcMain.handle("engine:newSession", async () => {
    await (await requireAdapter()).newSession();
  });

  ipcMain.handle("project:pickDialog", async () => {
    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: "选择项目文件夹",
    });
    if (result.canceled || result.filePaths.length === 0) return undefined;
    return result.filePaths[0];
  });
}
