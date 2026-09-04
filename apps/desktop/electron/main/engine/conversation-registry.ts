import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  EngineEvent,
  HostApprovalParams,
  HostApprovalResult,
  HostSubagentParams,
  HostToolExecuteParams,
  HostToolResult,
  HostUiParams,
} from "@pi-wood/ipc-schema";
import type { EngineAdapter, EngineStartInfo } from "@pi-wood/engine";
import { EngineHost } from "./engine-host";
import {
  canTransition,
  normalizeMaxLiveEngines,
  pickSuspendCandidate,
  planAdmit,
  planRestart,
  summarizeConversations,
  transition,
  type ConversationRecord,
  type ConversationStatus,
} from "./conversation-core";

/**
 * ConversationRegistry —— 对话 → 引擎子进程的注册表（T8.1）
 *
 * 一条对话一个 `EngineHost`（= 一个 utilityProcess）。本模块只管「谁活着、谁该让位、崩了怎么收拾」，
 * 判定逻辑全在 conversation-core.ts 的纯函数里（可穷举单测）。
 *
 * 与 engine-manager 的关系是**单向**的：注册表不 import 引擎管理器，
 * 宿主能力（桌面工具执行、ctx.ui 往返、审批裁决、子代理镜像）由 `configureCapabilities()` 注入，
 * 否则会变成 manager ↔ registry 的循环依赖。
 *
 * 关停红线（都来自纯函数的判据，不在此处重复实现）：
 * - 超 `MAX_LIVE_ENGINES` 时**只关停** idle 且最久未活跃者；全在跑则拒绝新建并提示，不静默杀任务。
 * - streaming 中的对话永不自动关停（`session.dispose()` 内含 abortBash，会杀掉在跑的 npm test）。
 * - 丢帧计数、崩溃退避重启 ≤3、退出后残留扫描（只暴露不偷杀）。
 */

/** 宿主能力（由 engine-manager 提供；注册表侧只做转发与归属标注） */
export interface ConversationCapabilities {
  /** child 要生成哪些代理工具（名字来自 electron-free 的 spec 表） */
  hostToolNames(): string[];
  /** ESM-only 第一方扩展（如 vendored pi-subagent 入口）路径 */
  additionalExtensionPaths(): string[];
  executeHostTool(p: HostToolExecuteParams): Promise<HostToolResult>;
  /** T8.4：ctx.ui 请求带发起对话归属（PromptTray 来源行 + 应答者校验靠它） */
  requestUi(ctx: { conversationId: string; projectDir: string }, p: HostUiParams): Promise<unknown>;
  /** 审批裁决：策略判定 + 弹卡都在这条链里，child 没有本地放行路径 */
  decideApproval(ctx: { conversationId: string; projectDir: string }, p: HostApprovalParams): Promise<HostApprovalResult>;
  /** 可回传值：guard-tool 的拦截原因必须回到 child（deny-by-default 依赖这条回执） */
  onSubagent(ctx: { conversationId: string; projectDir: string }, p: HostSubagentParams): unknown;
  /** 每对话一条归一化事件（注册表已按 seq 对账；manager 据此推渲染层 + 跑 assist/goal/usage） */
  onEngineEvent(ctx: { conversationId: string; projectDir: string; seq: number }, event: EngineEvent): void;
  /**
   * 某个 child 装配完成（首建、休眠唤醒、崩溃重启都会走到）。
   * 模型/思考档位这类**会话内状态**必须在这里重设一次——只挂在「用户点项目」那条路径上，
   * 后台对话恢复后就会用 SDK 默认模型，用户切回去发现模型变了。
   */
  onConversationReady?(ctx: { conversationId: string; projectDir: string; boot: EngineStartInfo }): Promise<void> | void;
  /** 面向用户的告警（toast） */
  notify(message: string, type?: "info" | "warning" | "error"): void;
  /** 并发上限（来自 settings，缺省 3） */
  maxLiveEngines(): number;
  /** 崩溃退避重启次数上限（缺省 3） */
  maxRestarts?(): number;
}

export interface ConversationHandle {
  id: string;
  projectDir: string;
  worktreePath?: string;
  host: EngineHost;
  adapter: RemoteAdapterLike;
  record: ConversationRecord;
  /** 装配回执（pid/工具集/耗时/RSS），探针与面板都读它 */
  boot: EngineStartInfo | undefined;
  restarting: boolean;
}

/** 注册表用到的 adapter 面（RemoteEngineAdapter 的结构子集，便于回路实现替身） */
export type RemoteAdapterLike = EngineAdapter & {
  readonly transportKind: "child" | "loopback";
  isAlive(): boolean;
};

let caps: ConversationCapabilities | undefined;
const handles = new Map<string, ConversationHandle>();
const byProject = new Map<string, string>(); // projectDir → conversationId（T8.1 仍是一项目一对话）
let activeConversationId: string | undefined;
let forkCount = 0;

export function configureCapabilities(next: ConversationCapabilities): void {
  caps = next;
}

function needCaps(): ConversationCapabilities {
  if (!caps) throw new Error("ConversationRegistry 未初始化：engine-manager 需先 configureCapabilities()");
  return caps;
}

/** 测试/探针用：清表（不关停进程，由调用方负责） */
export function resetRegistryForTest(): void {
  handles.clear();
  byProject.clear();
  activeConversationId = undefined;
  forkCount = 0;
}

export function listConversations() {
  return summarizeConversations([...handles.values()].map((h) => h.record));
}

export function getActiveConversationId(): string | undefined {
  return activeConversationId;
}

/**
 * T8.2：渲染层告知「用户正在看这条对话」。
 * 只接受存在且未死的对话；切换即刷新 lastActiveAt —— LRU 因此永远挑不中正在被看的那条。
 */
export function setActiveConversation(id: string): boolean {
  const h = handles.get(id);
  if (!h || h.record.status === "dead") return false;
  activeConversationId = id;
  touch(h);
  return true;
}

export function activeProjectDir(): string | undefined {
  return activeConversationId ? handles.get(activeConversationId)?.projectDir : undefined;
}

export function getConversation(id: string): ConversationHandle | undefined {
  return handles.get(id);
}

export function conversationForProject(projectDir: string): ConversationHandle | undefined {
  const id = byProject.get(projectDir);
  return id ? handles.get(id) : undefined;
}

/** 主进程当前有没有任何活跃（含在飞）对话 */
export function hasBusyConversation(): boolean {
  return [...handles.values()].some((h) => h.record.status === "streaming" || h.record.inFlightPrompt);
}

function setStatus(h: ConversationHandle, to: ConversationStatus): void {
  if (!canTransition(h.record.status, to)) {
    console.warn(`[engine] 忽略非法状态迁移 ${h.record.status} → ${to}（对话 ${h.id}）`);
    return;
  }
  h.record.status = transition(h.record.status, to);
}

function touch(h: ConversationHandle): void {
  h.record.lastActiveAt = Date.now();
}

/**
 * 取（必要时新建/唤醒）某项目的对话适配器。
 * 这是 engine-manager 那 11 处 `requireAdapter()` 的唯一改动点：语义从「唯一 adapter」变成「当前对话的 adapter」。
 */
export async function ensureConversation(projectDir: string): Promise<RemoteAdapterLike> {
  const existing = conversationForProject(projectDir);
  if (existing && existing.host.alive && existing.record.status !== "dead") {
    activeConversationId = existing.id;
    touch(existing);
    return existing.adapter;
  }
  // 进程已经不在了（休眠或崩溃）：摘掉旧句柄再重开，否则表里会攒一堆永不活跃的僵尸记录。
  // 会话文件随句柄一起带走，重开时按它把上下文接回。
  const resumeSessionFile = existing?.record.sessionFile;
  const carriedRestarts = existing?.record.restarts ?? 0;
  if (existing) {
    handles.delete(existing.id);
    if (byProject.get(projectDir) === existing.id) byProject.delete(projectDir);
  }

  // 腾位置：纯函数一次只给一个 victim，超得多的时候要循环（否则会「休眠一条仍超限」）
  const maxLive = normalizeMaxLiveEngines(needCaps().maxLiveEngines());
  for (;;) {
    const plan = planAdmit([...handles.values()].map((h) => h.record), maxLive, { activeId: activeConversationId });
    if (plan.action === "admit") break;
    if (plan.action === "reject") throw new Error(plan.reason);
    const victim = handles.get(plan.conversationId);
    if (!victim) break;
    needCaps().notify(`并发引擎已满（上限 ${maxLive}），已休眠后台对话「${shortDir(victim.projectDir)}」以腾出位置`, "info");
    const done = await suspendConversation(victim.id);
    if (!done) break; // 休眠没成（理论上不该发生）→ 不再空转，交给下一步判定
  }

  const id = `conv-${++forkCount}-${randomUUID().slice(0, 8)}`;
  const record: ConversationRecord = {
    id,
    projectDir,
    status: "spawning",
    lastActiveAt: Date.now(),
    lastSeq: 0,
    droppedEvents: 0,
    inFlightPrompt: false,
    pendingApprovals: 0,
    restarts: carriedRestarts,
    sessionFile: resumeSessionFile,
  };
  // 先定 active：spawnHandle 内部会回调 onConversationReady（设默认模型 / 推 model_changed），
  // 晚一步赋值会让首建的 active 对话被当成后台对话、不推 model_changed。
  activeConversationId = id;
  try {
    const handle = await spawnHandle(id, projectDir, record, resumeSessionFile);
    return handle.adapter;
  } catch (err) {
    // 起不来就把指针和表项清干净，别把 active 指向一个不存在的对话
    handles.delete(id);
    if (byProject.get(projectDir) === id) byProject.delete(projectDir);
    if (activeConversationId === id) activeConversationId = undefined;
    throw err;
  }
}

function shortDir(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? dir;
}

async function spawnHandle(
  id: string,
  projectDir: string,
  record: ConversationRecord,
  resumeSessionFile?: string,
): Promise<ConversationHandle> {
  const c = needCaps();
  const baseline = await countEngineishProcesses();
  const host = new EngineHost({
    conversationId: id,
    cwd: projectDir,
    executeHostTool: (p) => c.executeHostTool(p),
    requestUi: (ctx, p) => c.requestUi(ctx, p),
    decideApproval: (p) => c.decideApproval({ conversationId: id, projectDir }, p),
    onSubagent: (p) => c.onSubagent({ conversationId: id, projectDir }, p),
    onEvent: (event, seq) => {
      const h = handles.get(id);
      if (!h) return;
      applyStatusFromEvent(h, event);
      touch(h);
      c.onEngineEvent({ conversationId: id, projectDir: h.projectDir, seq }, event);
    },
    onDropped: (info) => {
      const h = handles.get(id);
      if (!h) return;
      h.record.droppedEvents = h.host.droppedEvents;
      if (info.dropped > 0) {
        console.warn(`[engine] 对话 ${id} 丢帧 ${info.dropped} 条（seq 跳到 ${info.seq}）`);
        c.notify(`引擎事件流出现 ${info.dropped} 条缺号（该对话可能缺少片段）`, "warning");
      }
    },
    onLog: (level, text) => {
      if (level === "error") console.error(text);
      else console.log(text);
    },
    onExit: ({ crashed }) => {
      const h = handles.get(id);
      if (!h) return;
      setStatus(h, "dead");
      h.record.inFlightPrompt = false;
      void residueCheck(id, h.host.pid, baseline, c);
      if (!crashed) return;
      void recoverAfterCrash(h, c);
    },
  });

  const handle: ConversationHandle = {
    id,
    projectDir,
    worktreePath: projectDir,
    host,
    adapter: host.adapter as unknown as RemoteAdapterLike,
    record,
    boot: undefined,
    restarting: false,
  };
  handles.set(id, handle);
  byProject.set(projectDir, id);

  await host.spawn();
  const info = await host.startEngine({
    projectDir,
    hostToolNames: c.hostToolNames(),
    additionalExtensionPaths: c.additionalExtensionPaths(),
    approvalMode: "delegated", // child 不本地判策略，见 engine-child.remoteApprovalGate
  });
  handle.boot = info;
  handle.record.pid = info.pid;
  handle.record.sessionFile = info.sessionFile ?? handle.record.sessionFile;
  const badDiag = (info.diagnostics ?? []).filter((d) => d.type === "error");
  if (badDiag.length > 0) {
    console.warn(`[engine] 对话 ${id} 扩展诊断 ${badDiag.length} 条 error：${badDiag.map((d) => d.message).join(" / ")}`);
  }
  // 崩溃恢复要把用户上一轮之前的会话切回去（会话文件按 cwd 归集，同一对话的 worktree 不变 ⇒ 一定可见）
  if (resumeSessionFile) {
    try {
      await handle.adapter.switchSession(resumeSessionFile);
    } catch (err) {
      console.warn(`[engine] 对话 ${id} 恢复会话失败（继续用新会话）：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  setStatus(handle, "idle");
  touch(handle);
  try {
    await c.onConversationReady?.({ conversationId: id, projectDir, boot: info });
  } catch (err) {
    console.warn(`[engine] 对话 ${id} 的 per-child 初始化抛错（不影响已就绪的引擎）：${err instanceof Error ? err.message : String(err)}`);
  }
  return handle;
}

/** 事件流里能确定状态的部分（其余状态由调用方在 prompt/approval 边界显式设置） */
function applyStatusFromEvent(h: ConversationHandle, event: EngineEvent): void {
  switch (event.type) {
    case "agent_start":
    case "turn_start":
      h.record.inFlightPrompt = true;
      setStatus(h, "streaming");
      return;
    case "approval_request":
      setStatus(h, "waiting_approval");
      return;
    case "agent_end":
    case "turn_end":
      return;
    case "agent_settled":
      h.record.inFlightPrompt = false;
      if (h.record.status === "streaming" || h.record.status === "waiting_approval") setStatus(h, "idle");
      return;
    case "queue_update":
      if (h.record.status === "streaming") return;
      setStatus(h, "queued");
      return;
    default:
      return;
  }
}

/** 标记「有审批在飞」，用于 isSuspendSafe（有待应答的对话不许被自动休眠） */
export function noteApprovalPending(id: string, delta: number): void {
  const h = handles.get(id);
  if (!h) return;
  h.record.pendingApprovals = Math.max(0, h.record.pendingApprovals + delta);
  if (delta > 0 && h.record.status === "streaming") setStatus(h, "waiting_approval");
  if (delta < 0 && h.record.pendingApprovals === 0 && h.record.status === "waiting_approval") {
    setStatus(h, h.record.inFlightPrompt ? "streaming" : "idle");
  }
}

export function markPromptInFlight(id: string, inFlight: boolean): void {
  const h = handles.get(id);
  if (!h) return;
  h.record.inFlightPrompt = inFlight;
  if (inFlight && h.record.status === "idle") setStatus(h, "streaming");
}

/** T8.5 prompt 闸门：超限入队时标「排队中」；拿到槽位后撤标（inFlight 接管状态） */
export function markPromptQueued(id: string, queued: boolean): void {
  const h = handles.get(id);
  if (!h) return;
  if (queued) {
    if (h.record.status === "idle" || h.record.status === "streaming") setStatus(h, "queued");
  } else if (h.record.status === "queued") {
    setStatus(h, h.record.inFlightPrompt ? "streaming" : "idle");
  }
}

/** 休眠：只留 sessionFile（+ T8.6 的 worktreePath），进程优雅退出 */
export async function suspendConversation(id: string): Promise<boolean> {
  const h = handles.get(id);
  if (!h || !h.host.alive) return false;
  if (!isSuspendable(h)) return false;
  setStatus(h, "idle"); // 只有 idle 才走到这里；显式化以便 transition 到 suspended
  const { graceful } = await h.host.dispose("suspend");
  h.record.sessionFile = h.boot?.sessionFile ?? h.record.sessionFile;
  setStatus(h, "suspended");
  if (!graceful) console.warn(`[engine] 对话 ${id} 休眠走了硬杀（child 未在超时内优雅退出）`);
  if (activeConversationId === id) activeConversationId = undefined;
  return true;
}

function isSuspendable(h: ConversationHandle): boolean {
  return h.record.status === "idle" && !h.record.inFlightPrompt && h.record.pendingApprovals === 0;
}

/** 关停并摘表（用户显式关闭对话） */
export async function closeConversation(id: string): Promise<boolean> {
  const h = handles.get(id);
  if (!h) return false;
  await h.host.dispose("close");
  handles.delete(id);
  if (byProject.get(h.projectDir) === id) byProject.delete(h.projectDir);
  if (activeConversationId === id) activeConversationId = undefined;
  return true;
}

/** 崩溃/异常退出后的退避重启（次数封顶；不猜「跑到哪了」，只把会话文件切回去） */
async function recoverAfterCrash(h: ConversationHandle, c: ConversationCapabilities): Promise<void> {
  const maxRestarts = c.maxRestarts?.() ?? 3;
  const plan = planRestart(h.record.restarts, { maxRestarts });
  if (!plan.allowed) {
    c.notify(`对话「${shortDir(h.projectDir)}」的引擎连续崩溃 ${h.record.restarts} 次，已停止自动重启。可在对话标签上手动恢复。`, "error");
    return;
  }
  h.restarting = true;
  h.record.restarts = plan.attempt;
  c.notify(`引擎子进程异常退出，${Math.round(plan.delayMs / 100) / 10}s 后自动重启（第 ${plan.attempt}/${maxRestarts} 次）`, "warning");
  await new Promise((r) => setTimeout(r, plan.delayMs));
  if (handles.get(h.id) !== h) return; // 期间被关掉了
  try {
    const oldPid = h.host.pid;
    handles.delete(h.id);
    if (byProject.get(h.projectDir) === h.id) byProject.delete(h.projectDir);
    h.host.kill();
    await spawnHandle(h.id, h.projectDir, { ...h.record, status: "spawning", lastSeq: 0, inFlightPrompt: false, pendingApprovals: 0 }, h.record.sessionFile);
    if (activeConversationId === h.id || oldPid === undefined) activeConversationId = h.id;
    c.notify(`对话「${shortDir(h.projectDir)}」的引擎已恢复，会话上下文保持不变`, "info");
  } catch (err) {
    c.notify(`引擎重启失败：${err instanceof Error ? err.message : String(err)}`, "error");
  } finally {
    h.restarting = false;
  }
}

/** 主进程退出前对所有 child 广播 shutdown 并等收敛 */
export async function shutdownAllConversations(): Promise<void> {
  await Promise.all([...handles.values()].map((h) => h.host.dispose("quit").catch(() => undefined)));
}

/** 空闲对话的 LRU 视图（面板/探针用） */
export function suspendCandidates(activeId = activeConversationId): string[] {
  return [...handles.values()]
    .filter((h) => isSuspendable(h) && h.id !== activeId)
    .sort((a, b) => a.record.lastActiveAt - b.record.lastActiveAt)
    .map((h) => h.id);
}

export function lruPickOfIdle(activeId = activeConversationId): string | undefined {
  return pickSuspendCandidate([...handles.values()].map((h) => h.record), { activeId });
}

/* ---------------- 残留看门狗（只暴露，不偷杀） ---------------- */

type ProcessCensus = { total: number; pids: number[] };

function enginesLike(): string[] {
  // node/python 是 MCP 与多数扩展子进程的主要形态；Electron 自身按进程名排除在外
  return process.platform === "win32" ? ["node.exe", "python.exe"] : ["node", "python3", "python"];
}

/** 起 child 前先数一次基线，退出后再数一次比对（本机实测口径见 T8.0 P1-e） */
function countEngineishProcesses(): Promise<ProcessCensus> {
  if (process.platform !== "win32") return Promise.resolve({ total: 0, pids: [] });
  return new Promise((resolve) => {
    execFile("tasklist", ["/FI", "STATUS eq RUNNING", "/FO", "CSV", "/NH"], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve({ total: 0, pids: [] });
      const wanted = new Set(enginesLike());
      const pids: number[] = [];
      for (const line of stdout.split("\n")) {
        const m = line.match(/^"([^"]+)","(\d+)"/);
        if (m && wanted.has(m[1].toLowerCase())) pids.push(Number(m[2]));
      }
      resolve({ total: pids.length, pids });
    });
  });
}

async function residueCheck(conversationId: string, childPid: number | undefined, baseline: ProcessCensus, c: ConversationCapabilities): Promise<void> {
  await new Promise((r) => setTimeout(r, 2_000)); // 给 OS 回收句柄的时间窗
  if (!childPid) return;
  const after = await countEngineishProcesses();
  const leaked = after.total - baseline.total;
  if (leaked <= 0) return;
  const fresh = after.pids.filter((p) => !baseline.pids.includes(p));
  console.warn(`[engine] 对话 ${conversationId}（child pid=${childPid}）退出后仍有 ${leaked} 个 node/python 残留：${fresh.join(",")}`);
  c.notify(
    `引擎对话「${conversationId}」退出后残留 ${leaked} 个派生进程（pid: ${fresh.slice(0, 6).join(", ")}）。未自动结束，请到任务管理器确认。`,
    "warning",
  );
}
