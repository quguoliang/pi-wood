import { nextRun, parseCron, recordRun, taskIdFor, validateDefinition, type LoopDefinition, type ScheduledTask } from "./scheduler-core.ts";
import {
  deleteTask,
  loopsDirFor,
  reconcileTasks,
  updateRunRecord,
  upsertManualTask,
  withStateLock,
  writeLoopFile,
  writeState,
} from "./loop-store.ts";

/**
 * T7.8 定时任务运行时（主进程常驻）。
 * - tick 每 30s：reconcile 任务集 → 到期且可认领 → 触发
 * - 触发：经注入的 adapter 起后台对话发 prompt，跑完记 run 记录（sessionId/耗时/状态）
 * - occurrence claiming + 文件锁：第二个实例抢不到同一 occurrence 就跳过
 * - 不 import 引擎（可测）；adapter 经 configure() 注入
 */

export interface SchedulerAdapter {
  /** 起一条后台对话并发送 prompt，返回 sessionId；失败抛错 */
  runTask(task: ScheduledTask): Promise<{ sessionId: string }>;
  /** 当前打开的项目目录列表（reconcile 项目 scope 用） */
  listProjectDirs(): string[];
}

interface RuntimeDeps {
  appDataDir: string;
  adapter: SchedulerAdapter | null;
  now(): number;
  tickMs: number;
}

let deps: RuntimeDeps | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

export function configureScheduler(d: { appDataDir: string; adapter?: SchedulerAdapter; now?: () => number; tickMs?: number }): void {
  deps = {
    appDataDir: d.appDataDir,
    adapter: d.adapter ?? null,
    now: d.now ?? (() => Date.now()),
    tickMs: d.tickMs ?? 30_000,
  };
}

export function setSchedulerAdapter(adapter: SchedulerAdapter | null): void {
  if (deps) deps.adapter = adapter;
}

function requireDeps(): RuntimeDeps {
  if (!deps) throw new Error("scheduler 未配置（configureScheduler 未调用）");
  return deps;
}

function scopeDirs(d: RuntimeDeps): Array<{ dir: string; projectDir?: string }> {
  const dirs: Array<{ dir: string; projectDir?: string }> = [{ dir: d.appDataDir }];
  for (const p of d.adapter?.listProjectDirs() ?? []) dirs.push({ dir: p, projectDir: p });
  return dirs;
}

export function listTasks(): ScheduledTask[] {
  const d = requireDeps();
  const tasks = reconcileTasks(d.appDataDir, scopeDirs(d));
  // 补 nextRunAt（展示用，不持久化）
  for (const t of tasks) {
    if (t.enabled) {
      const spec = parseCron(t.schedule);
      const next = spec ? nextRun(spec, d.now()) : null;
      t.run = { ...t.run, nextRunAt: next ?? undefined };
    }
  }
  return tasks;
}

export function createManualTask(def: LoopDefinition & { projectDir?: string }): { id?: string; error?: string } {
  const d = requireDeps();
  const err = validateDefinition(def);
  if (err) return { error: err };
  const id = upsertManualTask(d.appDataDir, null, def);
  return { id };
}

export function updateTask(id: string, patch: Partial<LoopDefinition>): { error?: string } {
  const d = requireDeps();
  const tasks = reconcileTasks(d.appDataDir, scopeDirs(d));
  const task = tasks.find((t) => t.id === id);
  if (!task) return { error: "任务不存在" };
  const next: LoopDefinition = {
    name: patch.name ?? task.name,
    schedule: patch.schedule ?? task.schedule,
    enabled: patch.enabled ?? task.enabled,
    model: patch.model ?? task.model,
    agent: patch.agent ?? task.agent,
    timezone: patch.timezone ?? task.timezone,
    prompt: patch.prompt ?? task.prompt,
  };
  const err = validateDefinition(next);
  if (err) return { error: err };
  if (task.source === "file" && task.filePath) {
    // 文件源：写回 loop 文件（改名时文件名不动——文件名只是容器）
    writeLoopFile(
      task.filePath.replace(/[/\\][^/\\]+$/, "").replace(/[/\\]\.pi-wood[/\\]loops$/, "").replace(/[/\\]loops$/, ""),
      task.name,
      next,
    );
  } else {
    upsertManualTask(d.appDataDir, id, { ...next, projectDir: task.projectDir });
  }
  return {};
}

export function removeTask(id: string): { error?: string } {
  const d = requireDeps();
  const task = reconcileTasks(d.appDataDir, scopeDirs(d)).find((t) => t.id === id);
  if (!task) return { error: "任务不存在" };
  deleteTask(d.appDataDir, task);
  return {};
}

/** 立即运行（不等下次触发）。 */
export async function runTaskNow(id: string): Promise<{ error?: string }> {
  const d = requireDeps();
  const task = reconcileTasks(d.appDataDir, scopeDirs(d)).find((t) => t.id === id);
  if (!task) return { error: "任务不存在" };
  await fireTask(d, task, task.run);
  return {};
}

async function fireTask(d: RuntimeDeps, task: ScheduledTask, prevRun: ScheduledTask["run"]): Promise<void> {
  const ranAt = d.now();
  const start = Date.now();
  let sessionId: string | undefined;
  let error: string | undefined;
  try {
    if (!d.adapter) throw new Error("引擎未就绪");
    const res = await d.adapter.runTask(task);
    sessionId = res.sessionId;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const spec = parseCron(task.schedule);
  const next = spec ? nextRun(spec, d.now()) : null;
  updateRunRecord(
    d.appDataDir,
    task.id,
    recordRun(prevRun, {
      ok: !error,
      error,
      sessionId,
      durationMs: Date.now() - start,
      ranAt,
      nextAt: next,
    }),
  );
}

/**
 * 单轮 tick：对到期任务做 occurrence claiming（锁内推进 lastScheduledFor + nextRunAt），
 * 抢到才触发。返回本轮触发的任务数（探针用）。
 */
export async function tickOnce(): Promise<number> {
  const d = requireDeps();
  if (ticking) return 0; // 单飞
  ticking = true;
  try {
    let fired = 0;
    const now = d.now();
    await withStateLock(d.appDataDir, (state) => {
      const tasks = reconcileTasks(d.appDataDir, scopeDirs(d));
      const due: Array<{ task: ScheduledTask; occurrence: number }> = [];
      for (const t of tasks) {
        if (!t.enabled) continue;
        const spec = parseCron(t.schedule);
        if (!spec) continue;
        // 首次运行（无认领记录）：直接按「now 所在分钟」为 occurrence（调度器从启动起生效，不回溯历史）
        const anchor = state.runs[t.id]?.lastScheduledFor ?? Math.floor(now / 60000) * 60000 - 60000;
        const next = nextRun(spec, anchor);
        if (next !== null && next <= now) {
          const claimed = state.runs[t.id]?.lastScheduledFor;
          if (claimed !== next) {
            due.push({ task: t, occurrence: next });
            state.runs[t.id] = { ...state.runs[t.id], lastScheduledFor: next };
          }
        }
      }
      if (due.length > 0) writeState(d.appDataDir, state);
      // 触发放锁外：异步 fire（不阻塞持锁）
      setImmediate(() => {
        void (async () => {
          for (const { task } of due) {
            const prev = reconcileTasks(d.appDataDir, scopeDirs(d)).find((t) => t.id === task.id)?.run ?? {};
            await fireTask(d, task, prev);
          }
        })();
      });
      fired = due.length;
    });
    return fired;
  } catch {
    return 0; // 锁超时/fs 失败：本轮跳过
  } finally {
    ticking = false;
  }
}

export function startScheduler(): void {
  const d = requireDeps();
  stopScheduler();
  timer = setInterval(() => {
    void tickOnce();
  }, d.tickMs);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
