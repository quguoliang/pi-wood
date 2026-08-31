import { ipcMain, BrowserWindow, dialog } from "electron";
import { execFile } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, relative } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { ENGINE_CHANNELS, PromptCommandSchema, type GitInfo, type RuntimeInfo } from "@pi-wood/ipc-schema";
import { SdkAdapter } from "@pi-wood/engine/sdk";
import type { DesktopUiBridge } from "@pi-wood/engine";
import { SnapshotService } from "../workbench/snapshot-service";
import { browserCustomTools } from "../agent-tools/browser-tools";
import { reinjectProviderEnv } from "../provider/provider-manager";
import { permissionGateExtension, type ApprovalPolicy } from "../security/approval-gate";
import { loadSettings } from "../settings-service";

/**
 * 引擎管理器（T1.3）：主进程持有当前项目的 SdkAdapter 单例。
 * 事件统一经 ENGINE_CHANNELS.event 推送渲染层；ctx.ui 的 notify 转发渲染层，
 * 阻塞式对话框（select/confirm/input）T2.x 接 Radix 时在此挂起 Promise。
 */

const StartArgSchema = z.object({ projectDir: z.string().min(1) });
const TextArgSchema = z.object({ text: z.string().min(1) });
const SetModelArgSchema = z.object({ provider: z.string(), modelId: z.string() });
const SetThinkingArgSchema = z.object({ level: z.string().min(1) });

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

let adapter: SdkAdapter | undefined;
let activeProject = "";
let activeSnapshots: SnapshotService | undefined;
let engineTransition: Promise<void> = Promise.resolve();
let approvalSeq = 0;
const pendingApprovals = new Map<number, (allow: boolean) => void>();
let uiRequestSeq = 0;
const pendingUiRequests = new Map<number, (value: string | boolean | undefined) => void>();

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
    const changed = statOut.split("\n").filter((l) => l.trim()).length;
    return { branch, changed, added, deleted, files: [] };
  } catch {
    return undefined;
  }
}

function send(channel: string, data: unknown): void {
  const win = BrowserWindow.getAllWindows()[0];
  win?.webContents.send(channel, data);
}

/** 审批门 T4.1：confirm 经渲染层 ApprovalCard 往返（阻塞式 IPC Promise） */
function confirmViaRenderer(title: string, message: string): Promise<boolean> {
  const id = ++approvalSeq;
  send("approval:request", { id, title, message });
  return new Promise<boolean>((resolve) => {
    pendingApprovals.set(id, resolve);
    setTimeout(() => {
      if (pendingApprovals.has(id)) {
        pendingApprovals.delete(id);
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
    pendingUiRequests.set(id, resolve);
    setTimeout(() => {
      if (pendingUiRequests.has(id)) {
        pendingUiRequests.delete(id);
        resolve(kind === "confirm" ? false : undefined);
      }
    }, 120_000);
  });
}

function uiBridge(): DesktopUiBridge {
  return {
    notify: (message, type) => send("ui:notify", { message, type: type ?? "info" }),
    select: (title, options) => requestUi("select", title, { options }) as Promise<string | undefined>,
    confirm: async (title, message) => Boolean(await requestUi("confirm", title, { message })),
    input: (title, placeholder) => requestUi("input", title, { placeholder }) as Promise<string | undefined>,
  };
}

async function ensureEngineUnlocked(projectDir: string): Promise<SdkAdapter> {
  if (adapter && activeProject === projectDir) return adapter;
  if (adapter) await adapter.stop();
  // T3.2：钥匙串密钥 → 环境变量（ModelRuntime 凭据解析）
  reinjectProviderEnv();
  const next = new SdkAdapter();
  await next.start({
    projectDir,
    uiBridge: uiBridge(),
    customTools: browserCustomTools(),
    inlineExtensions: [
      permissionGateExtension(
        () => getPolicy(),
        (title, message) => confirmViaRenderer(title, message),
      ),
    ],
  });
  const snapshots = new SnapshotService(projectDir, (m) => console.warn(m));
  activeSnapshots = snapshots;
  next.subscribe((event) => {
    send(ENGINE_CHANNELS.event, event);
    // T2.2：edit/write 前后快照 → diff 推送右栏（含相对路径解析）
    if (event.type === "tool_execution_start") {
      snapshots.snapshot(String(event.toolName ?? ""), event.input);
    }
    if (event.type === "tool_execution_end" && (event.toolName === "edit" || event.toolName === "write")) {
      for (const d of snapshots.collectChanges()) send(ENGINE_CHANNELS.diff, d);
    }
  });
  // 默认模型：settings.model 优先，否则 chat 优先、v4 兜底（目录随在线刷新变化，见 §8）
  try {
    const models = await next.getAvailableModels();
    const preferred = loadSettings().model as { provider?: string; id?: string } | undefined;
    let picked: { provider: string; id: string } | undefined;
    if (preferred?.provider && preferred.id && models.some((m) => m.provider === preferred.provider && m.id === preferred.id)) {
      picked = { provider: preferred.provider, id: preferred.id };
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
      await next.setModel(picked.provider, picked.id);
      send(ENGINE_CHANNELS.event, { type: "model_changed", ...picked });
    }
  } catch (err) {
    send("ui:notify", { message: `默认模型选择失败: ${String(err)}`, type: "warning" });
  }
  adapter = next;
  activeProject = projectDir;
  return next;
}

export async function ensureEngine(projectDir: string): Promise<SdkAdapter> {
  let result: SdkAdapter | undefined;
  engineTransition = engineTransition.catch(() => undefined).then(async () => {
    result = await ensureEngineUnlocked(projectDir);
  });
  await engineTransition;
  if (!result) throw new Error("引擎启动失败");
  return result;
}

export function getActiveAdapter(): SdkAdapter | undefined {
  return adapter;
}

export function getActiveProjectDir(): string {
  if (!activeProject) throw new Error("引擎未启动：请先选择项目");
  return activeProject;
}

export function getActiveProjectDirSafe(): string | undefined {
  return activeProject || undefined;
}

async function requireAdapter(): Promise<SdkAdapter> {
  if (!adapter) throw new Error("引擎未启动：请先选择项目");
  return adapter;
}

/** T2.2：diff 快照逻辑已迁至 workbench/snapshot-service.ts */

export function initEngineIpc(): void {
  // T4.1：审批决策回传（渲染层 ApprovalCard → 主进程 resolve）
  ipcMain.handle("approval:decide", (_e, raw: unknown) => {
    const { id, allow } = z.object({ id: z.number(), allow: z.boolean() }).parse(raw);
    pendingApprovals.get(id)?.(allow);
    pendingApprovals.delete(id);
    return true;
  });

  ipcMain.handle("ui:respond", (_e, raw: unknown) => {
    const { id, value } = z.object({
      id: z.number().int().positive(),
      value: z.union([z.string(), z.boolean()]).optional(),
    }).parse(raw);
    pendingUiRequests.get(id)?.(value);
    pendingUiRequests.delete(id);
    return true;
  });

  ipcMain.handle("engine:diffRevert", (_e, raw: unknown) => {
    const { changeId } = z.object({ changeId: z.string().min(1) }).parse(raw);
    if (!activeSnapshots) throw new Error("引擎未启动：没有可回滚的变更");
    try {
      const result = activeSnapshots.revert(changeId);
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
    const prepared = prepareAttachments(cmd.attachments ?? []);
    await a.prompt({
      text: prepared.text ? `${cmd.text}\n\n${prepared.text}` : cmd.text,
      images: [...(cmd.images ?? []), ...prepared.images],
      streamingBehavior: cmd.streamingBehavior,
    });
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
    const current = await requireAdapter();
    await current.setModel(provider, modelId);
    send(ENGINE_CHANNELS.event, { type: "model_changed", provider, id: modelId });
  });

  ipcMain.handle(ENGINE_CHANNELS.setThinking, async (_e, raw: unknown) => {
    const { level } = SetThinkingArgSchema.parse(raw);
    const current = await requireAdapter();
    const allowed = current.getAvailableThinkingLevels();
    if (!allowed.includes(level)) throw new Error(`当前模型不支持思考级别 ${level}`);
    await current.setThinkingLevel(level);
    send(ENGINE_CHANNELS.event, { type: "thinking_level_changed", thinkingLevel: level });
  });

  ipcMain.handle("engine:getThinkingLevels", async () => {
    return (await requireAdapter()).getAvailableThinkingLevels();
  });

  ipcMain.handle(ENGINE_CHANNELS.compact, async () => {
    await (await requireAdapter()).compact();
  });

  ipcMain.handle("engine:getAvailableModels", async () => {
    return (await requireAdapter()).getAvailableModels();
  });

  ipcMain.handle("engine:getState", async () => {
    return (await requireAdapter()).getState();
  });

  ipcMain.handle(ENGINE_CHANNELS.getRuntimeInfo, async (): Promise<RuntimeInfo> => {
    const [pi, gitInfo] = await Promise.all([
      (await requireAdapter()).getRuntimeInfo(),
      collectGitInfo(),
    ]);
    return {
      cwd: activeProject,
      platform: `${process.platform} ${process.arch}`,
      node: process.version,
      ...pi,
      git: gitInfo,
    };
  });

  ipcMain.handle("engine:newSession", async () => {
    await (await requireAdapter()).newSession();
  });

  ipcMain.handle("engine:reload", async () => {
    await (await requireAdapter()).reload();
    return true;
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
}
