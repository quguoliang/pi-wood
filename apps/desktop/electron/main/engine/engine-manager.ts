import { ipcMain, BrowserWindow, dialog } from "electron";
import { execFile } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, statSync, readdirSync, rmSync, existsSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir, homedir } from "node:os";
import { promisify } from "node:util";
import { z } from "zod";
import { ENGINE_CHANNELS, PromptCommandSchema, BtwAskCommandSchema, makeEngineEnvelope, type EnginePiTheme, type GitInfo, type HostApprovalParams, type HostSubagentParams, type HostToolExecuteParams, type HostUiParams, type RuntimeInfo, type SubagentRunInfo } from "@pi-wood/ipc-schema";
import { SdkAdapter } from "@pi-wood/engine/sdk";
import type { DesktopUiBridge, EngineAdapter, EngineStartInfo } from "@pi-wood/engine";
import { normalizeEngineEvent } from "@pi-wood/engine";
import { SnapshotService } from "../workbench/snapshot-service";
import { browserCustomTools } from "../agent-tools/browser-tools";
import { memoryCustomTools } from "../agent-tools/memory-tools";
import { ALL_HOST_TOOL_SPECS } from "../agent-tools/host-tool-specs";
import { reinjectProviderEnv } from "../provider/provider-manager";
import { getUsageTracker } from "../provider/usage-tracker";
import { permissionGateExtension, decide, describeApprovalCall, type ApprovalPolicy } from "../security/approval-gate";
import type { PiWoodSubagentRunView } from "../subagent/bridge";
import { aggregateRunUsage } from "../subagent/usage.ts";
import { loadSettings } from "../settings-service";
import { generateAssist } from "../assist/assist-service";
import { onGoalSettled } from "../goal/goal-runtime.ts";
import {
  closeConversation,
  configureCapabilities,
  conversationForProject,
  ensureConversation,
  getActiveConversationId,
  getConversation,
  listConversations,
  markPromptInFlight,
  noteApprovalPending,
  setActiveConversation,
  suspendConversation,
} from "./conversation-registry";

/**
 * 引擎管理器（T1.3 → T8.1）
 *
 * T8.1 起主进程**不再直接持有引擎**：Pi SDK 跑在 utilityProcess 里（一条对话一个进程），
 * 这里只保留「当前对话」的远程适配器 + 宿主能力（桌面工具执行、ctx.ui 往返、审批裁决、
 * 子代理 runs 镜像）+ 30 个 IPC handler 的业务编排。
 * 生命周期/并发上限/崩溃自愈的判定在 conversation-core.ts（纯函数）+ conversation-registry.ts。
 * 事件统一经 ENGINE_CHANNELS.event 推送渲染层；按对话路由是 T8.2 的事，
 * 本批仍只对 active 对话推全量事件，其余对话的引擎在后台跑但事件不进当前渲染契约。
 */

const StartArgSchema = z.object({ projectDir: z.string().min(1) });
const TextArgSchema = z.object({ text: z.string().min(1) });
const SetModelArgSchema = z.object({ provider: z.string(), modelId: z.string() });
const SetThinkingArgSchema = z.object({ level: z.string().min(1) });
const StagePastedTextArgSchema = z.object({ text: z.string().min(1) });

/** 粘贴文本落盘序号，防同一毫秒多次粘贴文件名冲突（T7.1）。 */
let pasteSeq = 0;

const IMAGE_MIME = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);
const MAX_TEXT_ATTACHMENT_BYTES = 1024 * 1024;

function prepareAttachments(paths: string[]): { text: string; images: Array<{ type: "image"; data: string; mimeType: string }> } {
  const textBlocks: string[] = [];
  const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
  for (const path of paths) {
    const stat = statSync(path);
    if (!stat.isFile()) continue;
    const mimeType = IMAGE_MIME.get(extname(path).toLowerCase());
    const displayPath = activeProject ? relative(activeProject, path) || basename(path) : path;
    if (mimeType) {
      images.push({ type: "image", data: readFileSync(path).toString("base64"), mimeType });
      textBlocks.push(`<file name="${displayPath}"></file>`);
      continue;
    }
    const bytes = readFileSync(path);
    if (bytes.includes(0)) {
      textBlocks.push(`<file name="${displayPath}">二进制文件，路径：${path}</file>`);
      continue;
    }
    const truncated = bytes.length > MAX_TEXT_ATTACHMENT_BYTES;
    const content = bytes.subarray(0, MAX_TEXT_ATTACHMENT_BYTES).toString("utf8");
    textBlocks.push(`<file name="${displayPath}">\n${content}${truncated ? "\n[内容超过 1 MiB，已截断]" : ""}\n</file>`);
  }
  return { text: textBlocks.join("\n"), images };
}

/** 当前 active 对话所属项目（git 信息、附件相对路径、快照都按它取） */
let activeProject = "";
/** 按项目的 diff 快照服务：后台对话的 edit/write 事件不能再写进「当时前台项目」的快照里 */
const snapshotsByProject = new Map<string, SnapshotService>();
/** 宿主工具实现表（child 侧只有代理工具，执行回到这里） */
let hostTools: Map<string, ReturnType<typeof browserCustomTools>[number]> | undefined;
/** 子代理 runs 的跨进程快照镜像（child 每对话一份，主进程只留最新快照供面板/成本汇总） */
const subagentMirror = new Map<string, PiWoodSubagentRunView[]>();
// T7.6：与主会话完全隔离的「侧边问答」第二运行时（独立 session/事件流，绝不影响主 adapter）
let btwAdapter: SdkAdapter | undefined;
let btwUnsub: (() => void) | undefined;
// T7.9：会话辅助——采集每轮 用户输入 / 助手正文，settled 后触发一次辅助生成
let assistUserText = "";
let assistTextBuf = "";
let assistAborted = false;
let engineTransition: Promise<void> = Promise.resolve();
let approvalSeq = 0;
const pendingApprovals = new Map<number, { conv: string; resolve: (allow: boolean) => void }>();
let uiRequestSeq = 0;
const pendingUiRequests = new Map<
  number,
  { kind: "select" | "confirm" | "input"; resolve: (value: string | boolean | undefined) => void }
>();
let capabilitiesInstalled = false;

const execFileAsync = promisify(execFile);

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: activeProject, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

async function collectGitInfo(): Promise<GitInfo | undefined> {
  try {
    const branch = (await git(["branch", "--show-current"])).trim() || undefined;
    const statOut = await git(["diff", "--numstat", "HEAD"]);
    let added = 0;
    let deleted = 0;
    for (const line of statOut.split("\n")) {
      const m = line.match(/^(\d+)\t(\d+)\t/);
      if (m) {
        added += Number(m[1]);
        deleted += Number(m[2]);
      }
    }
    const nameStatus = await git(["diff", "--name-status", "HEAD"]).catch(() => "");
    const files = nameStatus
      .split("\n")
      .filter((l) => l.trim())
      .slice(0, 40)
      .map((line) => {
        const parts = line.split("\t");
        return { status: parts[0] ?? "", path: parts[parts.length - 1] ?? "" };
      });
    const changed = statOut.split("\n").filter((l) => l.trim()).length;
    return { branch, changed, added, deleted, files };
  } catch {
    return undefined;
  }
}

/**
 * 渲染层投递出口（T8.2）。
 *
 * 两条硬规矩：
 * 1. **丢事件不许静默**——无窗口/已销毁/发送抛错都计入 `sendDrops`，每 200 条汇总 warn 一次
 *    （关窗竞态本就短暂，但持续掉事件说明路由表错了）。
 * 2. 路由表按 `conversationId → webContents` 预留（现状仍是单窗口单实例锁），
 *    将来多窗口时只改这一处，业务侧 `pushEngineEvent` 的调用点不动。
 */
const targetByConversation = new Map<string, Electron.WebContents>();
let sendDrops = 0;

function deliver(wc: Electron.WebContents | undefined, channel: string, data: unknown): boolean {
  if (!wc || wc.isDestroyed()) {
    sendDrops += 1;
  } else {
    try {
      wc.send(channel, data);
      return true;
    } catch {
      sendDrops += 1; // webContents 已销毁：挡掉 "Object has been destroyed"
    }
  }
  if (sendDrops === 1 || sendDrops % 200 === 0) {
    console.warn(`[engine] 渲染层推送累计丢弃 ${sendDrops} 条（窗口未就绪/已销毁？通道 ${channel}）`);
  }
  return false;
}

function send(channel: string, data: unknown, conversationId?: string): void {
  const routed = conversationId ? targetByConversation.get(conversationId) : undefined;
  if (routed) {
    deliver(routed, channel, data);
    return;
  }
  // 兜底：单窗口现状（保留 getAllWindows()[0]，但不再假设它一定活着）
  deliver(BrowserWindow.getAllWindows()[0]?.webContents, channel, data);
}

/** 事件域唯一出口：一律包 envelope（渲染层按 conversationId 路由，不串台） */
function pushEngineEvent(conversationId: string, projectDir: string, event: unknown, seq?: number): void {
  const active = conversationId === getActiveConversationId();
  send(ENGINE_CHANNELS.event, makeEngineEnvelope(conversationId, projectDir, event, { seq, active }), conversationId);
}

/**
 * 非事件域（assist / 子代理事件）：载荷形状**保持不变**、只追加 `conversationId` 字段——
 * 渲染层现有消费者读不到新字段也照常工作（多出来的字段被忽略），等 T8.3 的多对话标签条
 * 真正把「按对话取数」接起来时再统一换成 envelope（含 `subagentRuns` 那条数组载荷）。
 */
function pushForConversation(
  channel: string,
  ctx: { conversationId: string; projectDir: string },
  payload: Record<string, unknown>,
): void {
  send(channel, { ...payload, conversationId: ctx.conversationId, projectDir: ctx.projectDir }, ctx.conversationId);
}

/** 审批门 T4.1：confirm 经渲染层 ApprovalCard 往返（阻塞式 IPC Promise）。T8.1 起带归属对话 */
function confirmViaRenderer(conversationId: string, title: string, message: string, toolName?: string): Promise<boolean> {
  const id = ++approvalSeq;
  send("approval:request", { id, conversationId, title, message, toolName });
  noteApprovalPending(conversationId, +1);
  return new Promise<boolean>((resolve) => {
    pendingApprovals.set(id, { conv: conversationId, resolve });
    setTimeout(() => {
      if (pendingApprovals.has(id)) {
        pendingApprovals.delete(id);
        noteApprovalPending(conversationId, -1);
        resolve(false); // 超时默认拒绝（方案 §9）
      }
    }, 120_000);
  });
}

function getPolicy(): ApprovalPolicy {
  return loadSettings().approval as ApprovalPolicy;
}

function requestUi(
  kind: "select" | "confirm" | "input",
  title: string,
  payload: { options?: string[]; message?: string; placeholder?: string },
): Promise<string | boolean | undefined> {
  const id = ++uiRequestSeq;
  send("ui:request", { id, kind, title, ...payload });
  return new Promise((resolve) => {
    pendingUiRequests.set(id, { kind, resolve });
    setTimeout(() => {
      if (pendingUiRequests.has(id)) {
        pendingUiRequests.delete(id);
        resolve(kind === "confirm" ? false : undefined);
      }
    }, 120_000);
  });
}

/**
 * 桌面 ctx.ui 桥（notify/select/confirm/input）经 ui:notify + ui:request/ui:respond 走渲染层 PromptTray。
 * T5.2 插件宿主复用同一桥实现插件的 notify / ui.*，不另立通道。
 */
export function uiBridge(): DesktopUiBridge {
  return {
    notify: (message, type) => send("ui:notify", { message, type: type ?? "info" }),
    select: (title, options) => requestUi("select", title, { options }) as Promise<string | undefined>,
    confirm: async (title, message) => Boolean(await requestUi("confirm", title, { message })),
    input: (title, placeholder) => requestUi("input", title, { placeholder }) as Promise<string | undefined>,
  };
}

type HostTool = ReturnType<typeof browserCustomTools>[number];

/** 宿主工具实现表：child 侧只有同名代理工具，真正执行回到这里（一次构建，进程内复用） */
function hostToolMap(): Map<string, HostTool> {
  if (!hostTools) {
    const map = new Map<string, HostTool>();
    for (const t of [...browserCustomTools(), ...memoryCustomTools()]) {
      // 工具名校验：OpenAI 兼容端点（DeepSeek 等）要求 function.name 匹配 ^[a-zA-Z0-9_-]+$，
      // 含「.」等字符会让整轮请求 400、助手回复静默为空（曾踩坑）。启动即失败，别留给线上「消息无回复」。
      if (!/^[a-zA-Z0-9_-]+$/.test(t.name)) {
        throw new Error(`非法工具名 "${t.name}"：须匹配 ^[a-zA-Z0-9_-]+$（不能用「.」，如 memory_save）`);
      }
      map.set(t.name, t);
    }
    hostTools = map;
  }
  return hostTools;
}

/** 按项目取快照服务（后台对话的 edit/write 不能污染当时前台项目的 diff 面板） */
function snapshotsFor(projectDir: string): SnapshotService {
  let s = snapshotsByProject.get(projectDir);
  if (!s) {
    s = new SnapshotService(projectDir, (m) => console.warn(m));
    snapshotsByProject.set(projectDir, s);
  }
  return s;
}

/**
 * 子代理入口路径（ESM-only 的第一方扩展，交 child 侧 SDK 的 jiti 管线加载，不打进主进程 bundle）。
 * T8.P：产物是 ESM，用 import.meta.url 推导。
 * ⚠ packaged 下该相对路径落 asar 内不存在——已知遗留（T8.0/P1-d 同一口径），本轮只换基准不改语义。
 */
function subagentEntryPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../electron/main/subagent/pi-wood-subagent-entry.ts");
}

/** 当前 active 对话（引擎在子进程后，「取哪个 handle」的唯一入口） */
function activeConversation() {
  const id = getActiveConversationId();
  return id ? getConversation(id) : undefined;
}

/** 把注册表注入宿主能力（只做一次；注册表不 import 本模块，避免循环依赖） */
function installCapabilitiesOnce(): void {
  if (capabilitiesInstalled) return;
  capabilitiesInstalled = true;
  configureCapabilities({
    hostToolNames: () => ALL_HOST_TOOL_SPECS.map((s) => s.name),
    additionalExtensionPaths: () => {
      const p = subagentEntryPath();
      return existsSync(p) ? [p] : [];
    },
    executeHostTool: async (p: HostToolExecuteParams) => {
      const tool = hostToolMap().get(p.name);
      if (!tool) throw new Error(`宿主工具不存在：${p.name}`);
      const r = await tool.execute(
        p.toolCallId ?? "",
        (p.params ?? {}) as Record<string, unknown>,
        undefined, // signal：跨进程中断尚未接（子进程 abort 会中止整轮，工具本身跑完即弃）
        undefined, // onUpdate：宿主工具目前都不做增量回传
        undefined,
      );
      return { content: r.content as unknown[], details: r.details };
    },
    requestUi: async (p: HostUiParams) => {
      switch (p.op) {
        case "notify":
          send("ui:notify", { message: p.message, type: p.type ?? "info" });
          return undefined;
        case "select":
          return requestUi("select", p.title, { options: p.options });
        case "confirm":
          return Boolean(await requestUi("confirm", p.title, { message: p.message }));
        case "input":
          return requestUi("input", p.title, { placeholder: p.placeholder });
        default:
          return undefined;
      }
    },
    decideApproval: async (ctx, p: HostApprovalParams) => {
      const override = p.agentName ? loadSettings().subagentPermissions?.[p.agentName] : undefined;
      const decision = decide(getPolicy(), p.toolName, p.input, override);
      if (decision === "allow") return { allow: true };
      if (decision === "deny") {
        return {
          allow: false,
          reason:
            override?.[p.toolName] === "deny"
              ? `已由子代理「${p.agentName}」的 per-tool 权限拒绝（${p.toolName}: deny）`
              : "已由安全策略拦截（path-guard / denyAll）",
        };
      }
      // T7.2：该对话当前会话开了「自动接受」→ 升级成 allow（deny 分支已经在上面拦住，安全底线不可越）
      const conv = getConversation(ctx.conversationId);
      const sessionId = conv?.adapter.getSessionId() ?? conv?.boot?.sessionId;
      if (sessionId && loadSettings().autoAcceptSessions?.[sessionId] === true) return { allow: true };
      const { title, message } = describeApprovalCall(p.toolName, p.input);
      const ok = await confirmViaRenderer(ctx.conversationId, p.agentName ? `子代理「${p.agentName}」· ${title}` : title, message, p.toolName);
      return ok ? { allow: true } : { allow: false, reason: "用户拒绝该操作" };
    },
    onSubagent: (ctx, p: HostSubagentParams) => {
      switch (p.op) {
        case "runs": {
          const runs = p.runs as PiWoodSubagentRunView[];
          subagentMirror.set(ctx.conversationId, runs);
          // 载荷形状暂不改（数组 → {conversationId, runs} 的改造随 T8.3 多对话标签条一起做）
          if (ctx.conversationId === getActiveConversationId()) send(ENGINE_CHANNELS.subagentRuns, mapSubagentRuns(runs), ctx.conversationId);
          return undefined;
        }
        case "child-event": {
          if (ctx.conversationId !== getActiveConversationId()) return undefined;
          try {
            pushForConversation(ENGINE_CHANNELS.subagentEvent, ctx, { runId: p.runId, event: normalizeEngineEvent(p.event, () => undefined) });
          } catch {
            /* 单条事件归一失败忽略 */
          }
          return undefined;
        }
        case "guard-tool": {
          // 子代理孙会话的工具守卫：与父审批门同源（decide + ApprovalCard），child 无本地放行路径
          const override = p.agentName ? loadSettings().subagentPermissions?.[p.agentName] : undefined;
          const decision = decide(getPolicy(), p.toolName, p.input, override);
          if (decision === "allow") return { reason: undefined };
          if (decision === "deny") {
            return {
              reason:
                override?.[p.toolName] === "deny"
                  ? `已由子代理「${p.agentName}」的 per-tool 权限拒绝（${p.toolName}: deny）`
                  : "已由安全策略拦截（path-guard / denyAll）",
            };
          }
          const { title, message } = describeApprovalCall(p.toolName, p.input);
          return confirmViaRenderer(ctx.conversationId, p.agentName ? `子代理「${p.agentName}」· ${title}` : title, message, p.toolName).then(
            (ok) => ({ reason: ok ? undefined : "用户拒绝该操作" }),
          );
        }
        default:
          return undefined;
      }
    },
    onEngineEvent: (ctx, event) => {
      const isActive = ctx.conversationId === getActiveConversationId();
      const snapshots = snapshotsFor(ctx.projectDir);
      // T2.2：edit/write 前后快照 → diff 推送右栏（按项目分桶，后台对话不串台）
      // 注意：SDK 的 tool_execution_start 入参字段是 args（非 input），§8 实测
      if (event.type === "tool_execution_start") snapshots.snapshot(String(event.toolName ?? ""), event.args);
      if (event.type === "tool_execution_end" && (event.toolName === "edit" || event.toolName === "write")) {
        for (const d of snapshots.collectChanges()) if (isActive) send(ENGINE_CHANNELS.diff, d, ctx.conversationId);
      }
      // T8.2：**每条对话的事件都推**（带 envelope），由渲染层按 conversationId 决定进哪个切片/是否只更摘要。
      // 主进程不再替渲染层做「后台对话事件直接丢」的决定——那正是 T8.3 可见性节流要量化的对象。
      pushEngineEvent(ctx.conversationId, ctx.projectDir, event, ctx.seq);
      if (!isActive) return; // 本轮采集器（assist/goal/usage）是单槽位，只对 active 对话跑；按对话分片属 T8.7
      // T7.9：采集本轮助手正文 / 中断标记，settled 后触发一次会话辅助
      if (event.type === "message_update") {
        const a = (event as { assistantMessageEvent?: { type?: string; delta?: unknown } }).assistantMessageEvent;
        if (a?.type === "text_delta" && typeof a.delta === "string") assistTextBuf += a.delta;
      } else if (event.type === "turn_end") {
        const stopReason = (event as { message?: { stopReason?: string } }).message?.stopReason;
        if (stopReason === "aborted") assistAborted = true;
      } else if (event.type === "agent_settled") {
        const text = assistTextBuf;
        if (!assistAborted && text.trim()) {
          void generateAssist(assistUserText, text)
            .then((result) => {
              if (result) pushForConversation(ENGINE_CHANNELS.assistResult, ctx, result as unknown as Record<string, unknown>);
            })
            .catch(() => undefined);
        }
        const conv = activeConversation();
        const adapter = conv?.adapter;
        if (!conv || !adapter) return;
        // T7.5：目标模式 headless tick —— 每轮 settled 都走，runtime 内部判有无 active goal / aborted→暂停
        void onGoalSettled(
          {
            sessionId: adapter.getSessionId() ?? "",
            prompt: (t) => adapter.prompt({ text: t }),
            stats: async () => {
              const ri = await adapter.getRuntimeInfo();
              return { totalTokens: ri.stats?.tokens?.total ?? 0, costUsd: ri.stats?.cost ?? 0 };
            },
          },
          text,
          { aborted: assistAborted },
        ).catch(() => undefined);
        // T7.12：记一次会话累计用量到当前 provider/model（按快照求差，见 UsageTracker）
        void (async () => {
          try {
            const ri = await adapter.getRuntimeInfo();
            const model = ri.model;
            const sep = model ? model.indexOf("/") : -1;
            if (model && sep > 0 && ri.stats) {
              getUsageTracker()?.recordUsage(adapter.getSessionId() ?? "", model.slice(0, sep), model.slice(sep + 1), {
                ...ri.stats.tokens,
                cost: ri.stats.cost,
              });
            }
          } catch {
            /* 用量非关键路径 */
          }
        })();
      }
    },
    notify: (message, type) => send("ui:notify", { message, type: type ?? "info" }),
    onConversationReady: ({ conversationId, projectDir, boot }) =>
      ensureDefaultModelForConversation(conversationId, projectDir, boot.pid),
    maxLiveEngines: () => (loadSettings() as { engineMaxLive?: number }).engineMaxLive ?? 3,
    maxRestarts: () => 3,
  });
}

/** 默认模型初始化的幂等键 = 对话 id + child pid（崩溃重启复用 id，但那是个全新会话） */
const modelInitDone = new Set<string>();
/** 用户为某对话显式选过的模型/思考档位（child 重建后按此重放，见 T8.1 验收「唤醒后档位完整恢复」） */
const perConversationPrefs = new Map<string, { provider?: string; modelId?: string; thinkingLevel?: string }>();

function rememberPref(conversationId: string, patch: { provider?: string; modelId?: string; thinkingLevel?: string }): void {
  const prev = perConversationPrefs.get(conversationId) ?? {};
  perConversationPrefs.set(conversationId, { ...prev, ...patch });
}

/**
 * 默认模型：settings.model 优先，否则 chat 优先、v4 兜底（目录随在线刷新变化，见 §8）。
 * T8.1 挂在注册表的 per-child 钩子上（首建 + 唤醒 + 崩溃重启都会走），
 * 因为模型是**子进程里那个会话**的状态，不是主进程的全局状态。
 * 用户显式选过模型/思考档位时以选择为准（重放），未选过才走默认策略。
 */
async function ensureDefaultModelForConversation(conversationId: string, projectDir: string, pid: number): Promise<void> {
  const key = `${conversationId}:${pid}`;
  if (modelInitDone.has(key)) return;
  modelInitDone.add(key);
  const conv = getConversation(conversationId);
  if (!conv) return;
  const pref = perConversationPrefs.get(conversationId) ?? {};
  try {
    const models = await conv.adapter.getAvailableModels();
    let picked: { provider: string; id: string } | undefined;
    if (pref.provider && pref.modelId && models.some((m) => m.provider === pref.provider && m.id === pref.modelId)) {
      picked = { provider: pref.provider, id: pref.modelId };
    } else if (preferredModelAvailable(models)) {
      const p = loadSettings().model as { provider?: string; id?: string };
      picked = { provider: p.provider as string, id: p.id as string };
    } else {
      const candidates: Array<[string, string]> = [
        ["deepseek", "deepseek-chat"],
        ["deepseek", "deepseek-v4-flash"],
        ["deepseek", "deepseek-v4-pro"],
      ];
      for (const [provider, id] of candidates) {
        if (models.some((m) => m.provider === provider && m.id === id)) {
          picked = { provider, id };
          break;
        }
      }
      picked = picked ?? models[0];
    }
    if (picked) {
      await conv.adapter.setModel(picked.provider, picked.id);
      // T8.2：有了 envelope 归属，后台对话也照推（渲染层按 conversationId 落各自切片，不会再串台）
      pushEngineEvent(conversationId, projectDir, { type: "model_changed", ...picked });
      // 重放思考档位（模型换了以后档位是新会话的状态，不重放就退回「未设置」）
      if (pref.thinkingLevel) {
        const allowed = await conv.adapter.getAvailableThinkingLevels();
        if (allowed.includes(pref.thinkingLevel)) {
          await conv.adapter.setThinkingLevel(pref.thinkingLevel);
          pushEngineEvent(conversationId, projectDir, { type: "thinking_level_changed", thinkingLevel: pref.thinkingLevel });
        } else if (allowed.length > 0) {
          await conv.adapter.setThinkingLevel(allowed[0]);
          send("ui:notify", {
            message: `该对话恢复时模型 ${picked.provider}/${picked.id} 不支持思考档位 ${pref.thinkingLevel}，已切到 ${allowed[0]}`,
            type: "warning",
          });
        }
      }
    }
  } catch (err) {
    send("ui:notify", { message: `默认模型选择失败: ${String(err)}`, type: "warning" });
    modelInitDone.delete(key); // 失败不占位，下次激活还能重试
  }
}

function preferredModelAvailable(models: Array<{ provider: string; id: string }>): boolean {
  const p = loadSettings().model as { provider?: string; id?: string } | undefined;
  return Boolean(p?.provider && p.id && models.some((m) => m.provider === p.provider && m.id === p.id));
}

/**
 * 取当前项目的对话引擎（T8.1 起 = 惰性 fork 一个 utilityProcess 并装配引擎）。
 * 换项目不再关停旧引擎：它留在注册表里被 LRU/上限管着（这正是 D 方案要的「切回去不用重新冷启动」）。
 */
export async function ensureEngine(projectDir: string): Promise<EngineAdapter> {
  let result: EngineAdapter | undefined;
  engineTransition = engineTransition.catch(() => undefined).then(async () => {
    installCapabilitiesOnce();
    const previousProject = activeProject;
    // T3.2：钥匙串密钥 → 环境变量。必须在 fork 之前（child 直接继承 env，密钥不落 child 磁盘）。
    reinjectProviderEnv();
    result = await ensureConversation(projectDir);
    activeProject = projectDir;
    snapshotsFor(projectDir);
    if (previousProject && previousProject !== projectDir) await closeBtw(); // 侧边问答绑旧项目 cwd，换项目即释放
  });
  await engineTransition;
  if (!result) throw new Error("引擎启动失败");
  return result;
}

export function getActiveAdapter(): EngineAdapter | undefined {
  return activeConversation()?.adapter;
}

/** active 对话的装配回执（面板/探针读 pid、工具集、装配耗时、RSS） */
export function getActiveEngineBoot(): EngineStartInfo | undefined {
  return activeConversation()?.boot;
}

export function getActiveProjectDir(): string {
  if (!activeProject) throw new Error("引擎未启动：请先选择项目");
  return activeProject;
}

export function getActiveProjectDirSafe(): string | undefined {
  return activeProject || undefined;
}

async function requireAdapter(): Promise<EngineAdapter> {
  const a = getActiveAdapter();
  if (!a) throw new Error("引擎未启动：请先选择项目");
  return a;
}

async function requireActiveConversationId(): Promise<string> {
  const id = getActiveConversationId();
  if (!id) throw new Error("引擎未启动：请先选择项目");
  return id;
}

/** T7.6：合成 system-reminder——侧边问答只回答本问题，绝不继续主会话中正在进行的任务/计划。 */
const SIDE_REMINDER =
  "（by-the-way 侧边问答）这是用户在主会话之外发起的一个独立临时提问。请只回答下面这个问题；" +
  "不要继续、执行或推进主会话中正在进行的任何任务、计划或待办；上方的会话上下文仅供理解问题背景，不作为行动指令。";

function buildBtwPromptText(question: string, context?: string): string {
  const trimmed = (context ?? "").trim();
  const ctxBlock = trimmed ? `\n\n# 会话上下文（仅供参考，勿继续执行）\n${trimmed}` : "";
  return `${SIDE_REMINDER}${ctxBlock}\n\n# 侧边问题\n${question}`;
}

async function ensureBtwAdapter(): Promise<SdkAdapter> {
  if (btwAdapter) return btwAdapter;
  const projectDir = getActiveProjectDir(); // 侧边问答需引擎就绪
  reinjectProviderEnv();
  const next = new SdkAdapter();
  await next.start({
    projectDir,
    // 侧边问答保持安静：notify/对话框全部吞掉，避免与主会话 UI 抢焦点
    uiBridge: { notify: () => {}, select: async () => undefined, confirm: async () => false, input: async () => undefined },
    customTools: [],
    // denyAll 门：只读工具放行、其余一律拒绝 → 杜绝副作用与审批弹窗（纯问答）
    inlineExtensions: [permissionGateExtension(() => ({ mode: "denyAll", rules: [] }), async () => false)],
  });
  // 尽力套用与主会话一致的默认模型（best-effort，失败则用会话自带默认）
  try {
    const models = await next.getAvailableModels();
    const pref = loadSettings().model as { provider?: string; id?: string } | undefined;
    const picked =
      pref?.provider && pref.id && models.some((m) => m.provider === pref.provider && m.id === pref.id)
        ? { provider: pref.provider, id: pref.id }
        : models[0];
    if (picked) await next.setModel(picked.provider, picked.id);
  } catch {
    /* 忽略：交给 SDK 默认模型 */
  }
  btwUnsub = next.subscribe((event) => send(ENGINE_CHANNELS.btwEvent, event));
  btwAdapter = next;
  return next;
}

async function closeBtw(): Promise<void> {
  btwUnsub?.();
  btwUnsub = undefined;
  await btwAdapter?.stop();
  btwAdapter = undefined;
}

/** T6.3：把 vendored runs 视图映射成渲染层子代理面板用的 SubagentRunInfo[]。 */
function mapSubagentRuns(
  views: readonly {
    id: string;
    agent: string;
    harness: string;
    description: string;
    status: "running" | "completed" | "failed" | "cancelled";
    elapsedMs: number;
    turns: number;
    activity?: string;
  }[],
): SubagentRunInfo[] {
  return views.map((v) => ({
    id: v.id,
    agent: v.agent,
    harness: v.harness,
    description: v.description,
    status: v.status,
    elapsedMs: v.elapsedMs,
    turns: v.turns,
    activity: v.activity,
  }));
}

/** T2.2：diff 快照逻辑已迁至 workbench/snapshot-service.ts */

export function initEngineIpc(): void {
  // T4.1：审批决策回传（渲染层 ApprovalCard → 主进程 resolve）
  ipcMain.handle("approval:decide", (_e, raw: unknown) => {
    const { id, allow } = z.object({ id: z.number(), allow: z.boolean() }).parse(raw);
    const entry = pendingApprovals.get(id);
    if (entry) {
      pendingApprovals.delete(id);
      noteApprovalPending(entry.conv, -1);
      entry.resolve(allow);
    }
    return true;
  });

  ipcMain.handle("ui:respond", (_e, raw: unknown) => {
    const { id, value } = z.object({
      id: z.number().int().positive(),
      value: z.union([z.string(), z.boolean()]).optional(),
    }).parse(raw);
    pendingUiRequests.get(id)?.resolve(value);
    pendingUiRequests.delete(id);
    return true;
  });

  // T7.2：开启 per-session 自动接受时，立即放行当前所有在飞的审批/确认（select/input 不动）。
  // T8.1：只放行 **active 对话** 的在飞审批——跨对话放行等于替用户点头别的项目的写盘操作。
  ipcMain.handle("approval:acceptAll", () => {
    const activeId = getActiveConversationId();
    let accepted = 0;
    for (const [id, entry] of pendingApprovals) {
      if (!activeId || entry.conv !== activeId) continue;
      pendingApprovals.delete(id);
      noteApprovalPending(entry.conv, -1);
      entry.resolve(true);
      accepted += 1;
    }
    for (const [id, entry] of pendingUiRequests) {
      if (entry.kind !== "confirm") continue;
      entry.resolve(true);
      pendingUiRequests.delete(id);
      accepted += 1;
    }
    return accepted;
  });

  // T7.6：侧边问答——独立第二会话，不影响主会话；引擎未就绪时 ensureBtwAdapter 会抛错由渲染层提示。
  ipcMain.handle(ENGINE_CHANNELS.btwAsk, async (_e, raw: unknown) => {
    const { question, context } = BtwAskCommandSchema.parse(raw);
    const btw = await ensureBtwAdapter();
    await btw.prompt({ text: buildBtwPromptText(question, context) });
    return true;
  });
  ipcMain.handle(ENGINE_CHANNELS.btwAbort, async () => {
    await btwAdapter?.abort();
    return true;
  });
  ipcMain.handle(ENGINE_CHANNELS.btwClose, async () => {
    await closeBtw();
    return true;
  });

  // T6.3：子代理面板挂载时拉一次 runs 快照初值（后续增量走 subagentRuns 推送）。
  // T8.1：runs 归属各自的引擎子进程，主进程只保留镜像 → 面板看到的永远是 active 对话的。
  ipcMain.handle(ENGINE_CHANNELS.subagentList, () => {
    const id = getActiveConversationId();
    const runs = id ? subagentMirror.get(id) : undefined;
    return runs ? mapSubagentRuns(runs) : [];
  });

  ipcMain.handle("engine:diffRevert", (_e, raw: unknown) => {
    const { changeId } = z.object({ changeId: z.string().min(1) }).parse(raw);
    const snapshots = activeProject ? snapshotsByProject.get(activeProject) : undefined;
    if (!snapshots) throw new Error("引擎未启动：没有可回滚的变更");
    try {
      const result = snapshots.revert(changeId);
      send("ui:notify", { message: `已还原 ${result.file}`, type: "success" });
      return result;
    } catch (err) {
      send("ui:notify", { message: `还原失败：${err instanceof Error ? err.message : String(err)}`, type: "error" });
      throw err;
    }
  });

  ipcMain.handle("engine:switchSession", async (_e, raw: unknown) => {
    const { file } = z.object({ file: z.string().min(1) }).parse(raw);
    await (await requireAdapter()).switchSession(file);
    return true;
  });
  // ---- T1.3 压测钩子：注入 N 条消息事件验证虚拟列表（保留为 dev 工具）----
  ipcMain.handle("debug:stress", async (_e, raw: unknown) => {
    const { count } = z.object({ count: z.number().int().min(1).max(50000) }).parse(raw);
    const convId = getActiveConversationId();
    const dir = convId ? getConversation(convId)?.projectDir ?? "" : "";
    for (let i = 0; i < count; i++) {
      const fake = { type: "user_message", text: `压测消息 #${i + 1}` };
      // 引擎未起时（纯前端虚拟化压测）也要有归属：用 stress 作为合成对话 id，渲染层按 active 兜底照收
      if (convId) pushEngineEvent(convId, dir, fake);
      else send(ENGINE_CHANNELS.event, makeEngineEnvelope("stress", "", fake, { active: true }));
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
    const convId = getActiveConversationId();
    if (convId) targetByConversation.set(convId, _e.sender); // 选项目即绑定推送目标；未绑定的仍走单窗口兜底
    return true;
  });

  ipcMain.removeHandler(ENGINE_CHANNELS.prompt);
  ipcMain.handle(ENGINE_CHANNELS.prompt, async (_e, raw: unknown) => {
    const cmd = PromptCommandSchema.parse(raw);
    const convId = await requireActiveConversationId();
    const a = await requireAdapter();
    const prepared = prepareAttachments(cmd.attachments ?? []);
    // T7.9：本轮辅助采集边界
    assistUserText = cmd.text;
    assistTextBuf = "";
    assistAborted = false;
    // 在飞标记：事件流（agent_start/agent_settled）是主判据，这里补一个确定边界——
    // child 崩溃或在飞 RPC 无应答时 settled 事件可能永不到来，只靠事件清标记会把对话卡成「不可休眠」。
    markPromptInFlight(convId, true);
    try {
      await a.prompt({
        text: prepared.text ? `${cmd.text}\n\n${prepared.text}` : cmd.text,
        images: [...(cmd.images ?? []), ...prepared.images],
        streamingBehavior: cmd.streamingBehavior,
      });
    } finally {
      markPromptInFlight(convId, false);
    }
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
    const convId = await requireActiveConversationId();
    const current = await requireAdapter();
    await current.setModel(provider, modelId);
    rememberPref(convId, { provider, modelId }); // child 重建后按对话重放
    pushEngineEvent(convId, getActiveProjectDir(), { type: "model_changed", provider, id: modelId });
  });

  ipcMain.handle(ENGINE_CHANNELS.setThinking, async (_e, raw: unknown) => {
    const { level } = SetThinkingArgSchema.parse(raw);
    const convId = await requireActiveConversationId();
    const current = await requireAdapter();
    const allowed = await current.getAvailableThinkingLevels();
    if (!allowed.includes(level)) throw new Error(`当前模型不支持思考级别 ${level}`);
    await current.setThinkingLevel(level);
    rememberPref(convId, { thinkingLevel: level });
    pushEngineEvent(convId, getActiveProjectDir(), { type: "thinking_level_changed", thinkingLevel: level });
  });

  ipcMain.handle("engine:getThinkingLevels", async () => {
    const a = getActiveAdapter();
    return a ? a.getAvailableThinkingLevels() : [];
  });

  ipcMain.handle(ENGINE_CHANNELS.compact, async () => {
    await (await requireAdapter()).compact();
  });

  ipcMain.handle("engine:getAvailableModels", async () => {
    // 只读查询：引擎未启动时降级为空（§8 状态不变量：渲染层仍应以 engineReady 门禁）
    const a = getActiveAdapter();
    return a ? a.getAvailableModels() : [];
  });

  ipcMain.handle(ENGINE_CHANNELS.listCommands, async () => {
    // T5.1 只读聚合：引擎未启动时降级为空（渲染层另以 resources:list 兜底 skill/prompt）
    const a = getActiveAdapter();
    return a ? a.listCommands() : [];
  });

  ipcMain.handle(ENGINE_CHANNELS.getPiTheme, (): EnginePiTheme | null => {
    // T3.3：读取 ~/.pi/agent/themes/<name>.json（社区/用户主题即此 JSON 格式）；
    // 未配置 settings.theme.pi 或文件缺失 → null，渲染层保留内置 light/dark 兜底。
    try {
      const themeName = (loadSettings().theme as { pi?: string } | undefined)?.pi;
      if (!themeName) return null;
      const file = join(homedir(), ".pi", "agent", "themes", `${themeName}.json`);
      if (!existsSync(file)) return null;
      const parsed = JSON.parse(readFileSync(file, "utf-8")) as {
        name?: string;
        vars?: Record<string, string | number>;
        colors?: Record<string, string | number>;
      };
      return { name: parsed.name ?? themeName, vars: parsed.vars ?? {}, colors: parsed.colors ?? {} };
    } catch {
      return null;
    }
  });

  ipcMain.handle("engine:getState", async () => {
    const a = getActiveAdapter();
    return a ? a.getState() : {};
  });

  ipcMain.handle(ENGINE_CHANNELS.getRuntimeInfo, async (): Promise<RuntimeInfo> => {
    const a = getActiveAdapter();
    const conv = a ? activeConversation() : undefined;
    const [pi, gitInfo] = await Promise.all([
      a ? a.getRuntimeInfo() : Promise.resolve({}),
      collectGitInfo(),
    ]);
    // T6.6：把当前对话子代理运行注册表的 token/费用汇总进 RuntimeInfo（无子代理 → undefined）
    const runs = conv ? subagentMirror.get(conv.id) : undefined;
    const subagentUsage = aggregateRunUsage(runs ?? []);
    return {
      cwd: activeProject,
      platform: `${process.platform} ${process.arch}`,
      node: process.version,
      ...pi,
      subagentUsage,
      git: gitInfo,
      // T8.1：引擎在子进程后面板要能指出「跑在哪个 pid、装配花了多久、占多少 RSS」
      engineProcess: conv?.boot
        ? {
            pid: conv.boot.pid,
            conversationId: conv.id,
            status: conv.record.status,
            bootMs: conv.boot.timings?.totalMs,
            memRssMB: conv.boot.memRssMB,
            droppedEvents: conv.record.droppedEvents,
          }
        : undefined,
    };
  });

  ipcMain.handle("engine:newSession", async () => {
    await (await requireAdapter()).newSession();
  });

  ipcMain.handle("engine:reload", async () => {
    await (await requireAdapter()).reload();
    return true;
  });

  // T8.1 步骤 10：此前 ENGINE_CHANNELS.fork 只有通道声明、没有 handler。
  // 语义先定为「在当前对话里从某条消息分出一个新会话」（SDK runtime.fork），
  // 「另开一条自带独立 worktree 的新对话」等 T8.6 落地后再改，避免同项目两对话互踩。
  ipcMain.handle(ENGINE_CHANNELS.fork, async (_e, raw: unknown) => {
    const { entryId, position } = z
      .object({ entryId: z.string().min(1), position: z.enum(["before", "at"]) })
      .parse(raw);
    await (await requireAdapter()).fork(entryId, position);
    return true;
  });

  // ---- T8.2 对话域（渲染层接线在 T8.3 的多对话标签条）----
  ipcMain.handle(ENGINE_CHANNELS.listConversations, () => listConversations());

  ipcMain.handle(ENGINE_CHANNELS.suspendConversation, async (_e, raw: unknown) => {
    const { conversationId } = z.object({ conversationId: z.string().min(1) }).parse(raw);
    return suspendConversation(conversationId);
  });

  ipcMain.handle(ENGINE_CHANNELS.closeConversation, async (_e, raw: unknown) => {
    const { conversationId } = z.object({ conversationId: z.string().min(1) }).parse(raw);
    return closeConversation(conversationId);
  });

  /**
   * 渲染层告知「用户正在看这条对话」。顺带完成两件事：
   * ① 登记 conversationId → webContents 路由表（多窗口时事件只回给问它的那个窗口）；
   * ② 返回该对话快照，渲染层据此决定要不要重新装载历史。
   */
  ipcMain.handle(ENGINE_CHANNELS.setActiveConversation, async (_e, raw: unknown) => {
    const { conversationId } = z.object({ conversationId: z.string().min(1) }).parse(raw);
    const h = getConversation(conversationId);
    if (!h) return { ok: false as const, reason: "对话不存在（可能已被回收）" };
    targetByConversation.set(conversationId, _e.sender);
    const ok = setActiveConversation(conversationId);
    return { ok, projectDir: h.projectDir, status: h.record.status, droppedEvents: h.record.droppedEvents };
  });

  /** 显式新建/唤醒某项目的对话（同项目多对话等 T8.6 worktree 才真正放开，现在等价于「切过去」） */
  ipcMain.handle(ENGINE_CHANNELS.createConversation, async (_e, raw: unknown) => {
    const { projectDir } = StartArgSchema.parse(raw);
    const adapter = await ensureEngine(projectDir);
    const convId = getActiveConversationId() ?? "";
    targetByConversation.set(convId, _e.sender);
    return { conversationId: convId, cwd: projectDir, booted: Boolean(adapter) };
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

  ipcMain.handle("project:pickAttachments", async () => {
    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile", "multiSelections"],
      title: "添加到对话",
      filters: [
        { name: "代码、文本与图片", extensions: ["ts", "tsx", "js", "jsx", "json", "md", "txt", "css", "html", "py", "go", "rs", "java", "yaml", "yml", "xml", "csv", "sh", "png", "jpg", "jpeg", "webp", "gif"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (result.canceled) return [];
    return result.filePaths.map((path) => ({
      path,
      name: basename(path),
      size: statSync(path).size,
      kind: IMAGE_MIME.has(extname(path).toLowerCase()) ? "image" : "file",
    }));
  });

  // T7.1：大文本粘贴 → 落盘为临时文件，复用现有基于路径的附件管线（agent 经 <file> 块读取）。
  ipcMain.handle("engine:stagePastedText", async (_e, raw: unknown) => {
    const { text } = StagePastedTextArgSchema.parse(raw);
    const dir = join(tmpdir(), "pi-wood-pastes");
    mkdirSync(dir, { recursive: true });
    // 尽力回收 24h 前的旧粘贴文件，失败不影响本次写入。
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    try {
      for (const f of readdirSync(dir)) {
        if (!f.startsWith("pasted-text-")) continue;
        const fp = join(dir, f);
        try {
          if (statSync(fp).mtimeMs < cutoff) rmSync(fp, { force: true });
        } catch {
          /* 单个文件清理失败忽略 */
        }
      }
    } catch {
      /* 目录读取失败忽略，不影响主流程 */
    }
    const fileName = `pasted-text-${Date.now()}-${pasteSeq++}.txt`;
    const path = join(dir, fileName);
    writeFileSync(path, text, "utf8");
    return { path, name: fileName, size: Buffer.byteLength(text, "utf8"), kind: "file" as const };
  });
}
