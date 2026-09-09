import { ipcMain } from "electron";
import { join } from "node:path";
import {
  SCHEDULER_CHANNELS,
  ScheduledTaskInputSchema,
  type ScheduledTaskView,
} from "@pi-wood/ipc-schema";
import {
  configureScheduler,
  createManualTask,
  listTasks,
  removeTask,
  runTaskNow,
  setSchedulerAdapter,
  startScheduler,
  updateTask,
  type SchedulerAdapter,
} from "./scheduler-runtime.ts";
import { listConversations } from "../engine/conversation-registry.ts";

/** 与 settings-service 同源的 ~/.pi-wood 数据目录。 */
function appDataDir(): string {
  return join(process.env["USERPROFILE"] ?? process.env["HOME"] ?? ".", ".pi-wood");
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * T7.8 定时任务 IPC + 运行时挂载。
 * adapter.runTask：为任务起一条**新后台对话**（项目=任务 projectDir 或当前活跃项目）发 prompt。
 * 会话建立是异步的——这里只负责「发出去」，sessionId 先记 conversationId（探针/定位用）。
 */
export function initSchedulerIpc(deps: {
  sendToRenderer: (channel: string, data: unknown) => void;
  runPrompt: (projectDir: string, prompt: string) => Promise<{ sessionId: string }>;
}): void {
  const adapter: SchedulerAdapter = {
    runTask: async (task) => {
      const projectDir =
        task.projectDir ??
        listConversations()[0]?.projectDir ??
        process.cwd();
      const prompt = task.model
        ? `[定时任务「${task.name}」· 指定模型 ${task.model}（当前引擎不支持 per-call 换模型则忽略此行）]\n\n${task.prompt}`
        : task.prompt;
      return deps.runPrompt(projectDir, prompt);
    },
    listProjectDirs: () => listConversations().map((c) => c.projectDir),
  };

  configureScheduler({ appDataDir: appDataDir(), adapter });
  setSchedulerAdapter(adapter);
  startScheduler();

  ipcMain.handle(SCHEDULER_CHANNELS.list, (): ScheduledTaskView[] =>
    listTasks().map((t) => ({
      id: t.id,
      name: t.name,
      schedule: t.schedule,
      enabled: t.enabled,
      model: t.model,
      agent: t.agent,
      timezone: t.timezone,
      prompt: t.prompt,
      source: t.source,
      filePath: t.filePath,
      projectDir: t.projectDir,
      run: t.run,
    })),
  );

  ipcMain.handle(SCHEDULER_CHANNELS.save, (_e, raw: unknown): { id?: string; error?: string } => {
    const parsed = ScheduledTaskInputSchema.safeParse(raw);
    if (!parsed.success) return { error: "参数非法" };
    const input = parsed.data;
    const def = {
      name: input.name,
      schedule: input.schedule,
      enabled: input.enabled,
      model: input.model,
      agent: input.agent,
      timezone: input.timezone,
      prompt: input.prompt,
      projectDir: input.projectDir,
    };
    if (input.id) {
      const r = updateTask(str(input.id), def);
      return r.error ? { error: r.error } : { id: input.id };
    }
    const r = createManualTask(def);
    return r.error ? { error: r.error } : { id: r.id };
  });

  ipcMain.handle(SCHEDULER_CHANNELS.remove, (_e, raw: unknown): { error?: string } =>
    removeTask(str((raw as { id?: unknown })?.id)),
  );

  ipcMain.handle(SCHEDULER_CHANNELS.runNow, async (_e, raw: unknown): Promise<{ error?: string }> =>
    runTaskNow(str((raw as { id?: unknown })?.id)),
  );
}
