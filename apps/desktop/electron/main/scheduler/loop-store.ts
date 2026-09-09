import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseLoopFile, serializeLoopFile, taskIdFor, type LoopDefinition, type ScheduledTask, type ScheduledRunRecord } from "./scheduler-core.ts";

/**
 * T7.8 定时任务存储层。
 * - loop 文件：`<scope>/.pi-wood/loops/*.md`（项目 scope）与 `~/.pi-wood/loops/*.md`（用户 scope）
 * - 运行状态：`~/.pi-wood/loops-state.json`（id → ScheduledRunRecord），文件锁 `.json.lock` 序列化 read-modify-write
 * - manual 任务定义也存于 state 文件（definitions 字段）
 */

export interface LoopsState {
  definitions?: Record<string, LoopDefinition & { projectDir?: string }>; // manual 任务
  runs: Record<string, ScheduledRunRecord>;
}

function slugFile(name: string): string {
  return name.replace(/[^\w.-]/gi, "_").slice(0, 80);
}

export function loopsDirFor(scopeDir: string): string {
  // 项目 scope 的 loop 文件在 `<project>/.pi-wood/loops/`；用户 scope 直接传 ~/.pi-wood
  const dir = scopeDir.endsWith(".pi-wood") ? join(scopeDir, "loops") : join(scopeDir, ".pi-wood", "loops");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function statePath(appDataDir: string): string {
  mkdirSync(appDataDir, { recursive: true });
  return join(appDataDir, "loops-state.json");
}

function lockPath(appDataDir: string): string {
  return join(appDataDir, "loops-state.json.lock");
}

const LOCK_STALE_MS = 30_000;

/**
 * 跨实例文件锁：create-with-fail（wx）抢占，stale 超时强占。回调内做 read-modify-write。
 * 锁获取失败/超时 → 抛错（调用方降级跳过本轮 reconcile）。
 */
export async function withStateLock<T>(appDataDir: string, fn: (state: LoopsState) => T | Promise<T>): Promise<T> {
  const lp = lockPath(appDataDir);
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      writeFileSync(lp, String(process.pid), { flag: "wx" });
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      // stale 检测：锁文件老于 30s 认为持锁者已死
      try {
        const content = readFileSync(lp, "utf-8");
        void content;
        const { statSync } = await import("node:fs");
        const age = Date.now() - statSync(lp).mtimeMs;
        if (age > LOCK_STALE_MS) rmSync(lp, { force: true });
      } catch {
        /* 读取失败按存在处理 */
      }
      if (Date.now() > deadline) throw new Error("loops-state 锁等待超时");
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  try {
    return await fn(readState(appDataDir));
  } finally {
    try {
      rmSync(lp, { force: true });
    } catch {
      /* best-effort */
    }
  }
}

export function readState(appDataDir: string): LoopsState {
  const p = statePath(appDataDir);
  if (!existsSync(p)) return { runs: {} };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf-8")) as LoopsState;
    return { definitions: parsed.definitions ?? {}, runs: parsed.runs ?? {} };
  } catch {
    return { runs: {} };
  }
}

export function writeState(appDataDir: string, state: LoopsState): void {
  const p = statePath(appDataDir);
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  renameSync(tmp, p); // 原子替换
}

/** 列出某 scope 的 loop 文件任务（含解析失败的占位条目，附 parseError）。 */
export function scanLoopFiles(scopeDir: string, projectDir?: string): Array<{ task: ScheduledTask; parseError?: string }> {
  const dir = loopsDirFor(scopeDir);
  const out: Array<{ task: ScheduledTask; parseError?: string }> = [];
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return out;
  }
  for (const f of files) {
    const filePath = join(dir, f);
    const id = taskIdFor("file", filePath);
    let text = "";
    try {
      text = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const def = parseLoopFile(text);
    if (def) {
      out.push({
        task: { ...def, id, source: "file", filePath, projectDir, run: {} },
      });
    } else {
      out.push({
        task: {
          id,
          source: "file",
          filePath,
          projectDir,
          name: f.replace(/\.md$/, ""),
          schedule: "",
          enabled: false,
          prompt: "",
          run: {},
        },
        parseError: "frontmatter 解析失败（缺 name/schedule 或 cron 非法）",
      });
    }
  }
  return out;
}

export function writeLoopFile(scopeDir: string, name: string, def: LoopDefinition): string {
  const dir = loopsDirFor(scopeDir);
  const p = join(dir, `${slugFile(name)}.md`);
  writeFileSync(p, serializeLoopFile(def), "utf-8");
  return p;
}

export function deleteLoopFile(filePath: string): void {
  try {
    rmSync(filePath, { force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * reconcile：把「文件系统 loop 文件 + state 内 manual 定义 + run 记录」合并成当前任务全集。
 * - 文件改名/删除 → 按 filePath id 对账，消失的 file 任务剔除（保留其 run 记录在 state，30 天自然过期暂不实现）
 * - 解析失败的文件：若 state 中已有同 id 定义则保留上次好定义 + 打 parseError 标记（此处不存定义，简化为禁用占位）
 */
export function reconcileTasks(appDataDir: string, scopeDirs: Array<{ dir: string; projectDir?: string }>): ScheduledTask[] {
  const state = readState(appDataDir);
  const tasks: ScheduledTask[] = [];
  for (const { dir, projectDir } of scopeDirs) {
    for (const { task } of scanLoopFiles(dir, projectDir)) {
      tasks.push({ ...task, run: state.runs[task.id] ?? {} });
    }
  }
  for (const [id, def] of Object.entries(state.definitions ?? {})) {
    tasks.push({ ...def, id, source: "manual", run: state.runs[id] ?? {} });
  }
  return tasks.sort((a, b) => (a.run.nextRunAt ?? Infinity) - (b.run.nextRunAt ?? Infinity));
}

export function upsertManualTask(appDataDir: string, id: string | null, def: LoopDefinition & { projectDir?: string }): string {
  const state = readState(appDataDir);
  const finalId = id ?? taskIdFor("manual", "");
  state.definitions = state.definitions ?? {};
  state.definitions[finalId] = def;
  writeState(appDataDir, state);
  return finalId;
}

export function deleteTask(appDataDir: string, task: ScheduledTask): void {
  if (task.source === "file" && task.filePath) {
    deleteLoopFile(task.filePath);
  }
  const state = readState(appDataDir);
  if (state.definitions) delete state.definitions[task.id];
  delete state.runs[task.id];
  writeState(appDataDir, state);
}

export function updateRunRecord(appDataDir: string, id: string, run: ScheduledRunRecord): void {
  const state = readState(appDataDir);
  state.runs[id] = run;
  writeState(appDataDir, state);
}
