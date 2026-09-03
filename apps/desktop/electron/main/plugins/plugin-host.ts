import { utilityProcess } from "electron";
import {
  PLUGIN_CHANNELS,
  type PluginActivity,
  type PluginLifecycleStatus,
  type PluginPanelEntry,
  type PluginStatus,
  type PluginStatusItem,
} from "@pi-wood/ipc-schema";
import { checkPermission, type LoadedPlugin, type PluginToHost } from "@pi-wood/plugin-api";
import { discoverPlugins } from "./discovery.ts";
import { execCapability, type HostDeps } from "./capabilities.ts";

/** utilityProcess.fork 的返回类型（Electron 侧） */
type PluginProc = ReturnType<typeof utilityProcess.fork>;

const MAX_RESTARTS = 3;
const STABLE_UPTIME_MS = 30_000; // 存活超此值的崩溃不计入重启预算（视为偶发）
const RESTART_BASE_MS = 400;
const ACTIVITY_CAP = 60;
const LOG_LINE_CAP = 200;

interface Runtime {
  plugin: LoadedPlugin;
  proc?: PluginProc;
  status: PluginLifecycleStatus;
  pid?: number;
  restarts: number;
  startedAt: number;
  lastError?: string;
  lastCrashAt?: number;
  activity: PluginActivity[];
  /** 会话内已获用户运行时确认的敏感方法 */
  grantedSensitive: Set<string>;
  stoppingIntentionally: boolean;
  panels: Map<string, PluginPanelEntry>;
  statusItems: Map<string, PluginStatusItem>;
  restartTimer?: ReturnType<typeof setTimeout>;
}

export interface PluginHostServices extends HostDeps {
  appPath: string;
  getEnabledMap(): Record<string, boolean>;
  persistEnabled(id: string, enabled: boolean): void;
}

function previewArgs(args: unknown[]): string {
  try {
    const s = JSON.stringify(args);
    return s.length > 160 ? `${s.slice(0, 157)}…` : s;
  } catch {
    return "(不可序列化)";
  }
}

/**
 * 桌面插件宿主（T5.2，方案 §6）。每个插件 desktop.entry 跑独立 utilityProcess，
 * 主进程只做：权限门裁决 → 敏感操作运行时确认 → 代理执行 → 回结果；并负责崩溃自动重启与通知。
 */
export class PluginHost {
  private services: PluginHostServices;
  private runtimes = new Map<string, Runtime>();
  problems: string[] = [];

  constructor(services: PluginHostServices) {
    this.services = services;
  }

  /** 发现并（对已启用者）拉起全部插件。 */
  loadAndStart(): void {
    this.problems = [];
    const found = discoverPlugins(this.services.appPath, this.services.getEnabledMap(), this.problems);
    const seen = new Set<string>();
    for (const plugin of found) {
      seen.add(plugin.id);
      let rt = this.runtimes.get(plugin.id);
      if (rt) {
        rt.plugin = plugin; // 刷新声明
      } else {
        rt = {
          plugin,
          status: plugin.enabled ? "stopped" : "disabled",
          restarts: 0,
          startedAt: 0,
          activity: [],
          grantedSensitive: new Set(),
          stoppingIntentionally: false,
          panels: new Map(),
          statusItems: new Map(),
        };
        this.runtimes.set(plugin.id, rt);
      }
      if (plugin.enabled) this.fork(rt);
      else rt.status = "disabled";
    }
    // 移除已消失的插件
    for (const id of [...this.runtimes.keys()]) {
      if (!seen.has(id)) {
        const rt = this.runtimes.get(id);
        if (rt) this.stop(rt);
        this.runtimes.delete(id);
      }
    }
    this.pushStatus();
  }

  reload(): void {
    for (const rt of this.runtimes.values()) this.stop(rt);
    this.runtimes.clear();
    this.loadAndStart();
  }

  stopAll(): void {
    for (const rt of this.runtimes.values()) this.stop(rt);
  }

  private fork(rt: Runtime): void {
    if (rt.restartTimer) {
      clearTimeout(rt.restartTimer);
      rt.restartTimer = undefined;
    }
    rt.stoppingIntentionally = false;
    rt.grantedSensitive.clear();
    rt.status = rt.restarts > 0 ? "restarting" : "starting";
    rt.startedAt = Date.now();
    try {
      const proc = utilityProcess.fork(rt.plugin.entryPath, [], {
        stdio: ["ignore", "pipe", "pipe"],
        serviceName: `pi-wood-plugin-${rt.plugin.id}`,
        env: {
          ...process.env,
          PIWOOD_PLUGIN_ID: rt.plugin.id,
          PIWOOD_PLUGIN_DIR: rt.plugin.dir,
          PIWOOD_PLUGIN_PERMISSIONS: JSON.stringify(rt.plugin.permissions),
        },
      });
      proc.on("message", (msg: unknown) => this.onMessage(rt, msg as PluginToHost));
      proc.on("exit", (code: number) => this.onExit(rt, code));
      proc.stdout?.on("data", (chunk: Buffer) => this.onLog(rt, "info", chunk));
      proc.stderr?.on("data", (chunk: Buffer) => this.onLog(rt, "error", chunk));
      rt.proc = proc;
      rt.pid = proc.pid;
    } catch (e) {
      rt.status = "crashed";
      rt.lastError = e instanceof Error ? e.message : String(e);
      this.addActivity(rt, "crash", `fork 失败：${rt.lastError}`);
      this.services.ui.notify(`插件「${rt.plugin.displayName}」启动失败：${rt.lastError}`, "error");
    }
    this.pushStatus();
  }

  private onMessage(rt: Runtime, msg: PluginToHost): void {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ready") {
      rt.status = "running";
      this.addActivity(rt, "info", `已就绪（pid ${rt.pid ?? "?"}）· 权限 ${rt.plugin.permissions.length ? rt.plugin.permissions.join(",") : "无"}`);
      this.pushStatus();
      return;
    }
    if (msg.type === "log") {
      this.addActivity(rt, "log", msg.text);
      return;
    }
    if (msg.type === "invoke") {
      void this.handleInvoke(rt, msg);
    }
  }

  private async handleInvoke(rt: Runtime, msg: Extract<PluginToHost, { type: "invoke" }>): Promise<void> {
    const { id, method, args } = msg;
    const gate = checkPermission(method, rt.plugin.permissions);
    if (!gate.ok) {
      // 越权：拒绝 + 日志（验收硬指标②）
      this.addActivity(rt, "denied", gate.reason);
      console.warn(`[plugin:${rt.plugin.id}] ${gate.reason}`);
      this.reply(rt, id, false, undefined, gate.reason);
      this.pushStatus();
      return;
    }
    if (method === "getPermissions") {
      this.reply(rt, id, true, rt.plugin.permissions);
      return;
    }
    if (gate.needRuntimeConfirm && !rt.grantedSensitive.has(method)) {
      const ok = await this.services.ui.confirm(
        `插件「${rt.plugin.displayName}」请求执行敏感操作`,
        `方法：${method}\n参数：${previewArgs(args ?? [])}\n\n允许本次会话内该插件调用此能力？`,
      );
      if (!ok) {
        this.addActivity(rt, "confirm", `用户拒绝敏感操作 ${method}`);
        this.reply(rt, id, false, undefined, "用户拒绝了该敏感操作");
        this.pushStatus();
        return;
      }
      rt.grantedSensitive.add(method);
      this.addActivity(rt, "confirm", `已允许敏感操作 ${method}（本会话）`);
    }
    try {
      this.applyRegistrySideEffects(method, args ?? [], rt);
      const value = await execCapability(method, args ?? [], rt.plugin, this.services);
      this.addActivity(rt, "call", `${method} → ok`);
      this.reply(rt, id, true, value);
    } catch (e) {
      const msgText = e instanceof Error ? e.message : String(e);
      this.addActivity(rt, "info", `${method} 失败：${msgText}`);
      this.reply(rt, id, false, undefined, msgText);
    }
    this.pushStatus();
  }

  /** 面板/状态栏注册表与总线的宿主侧副作用（execCapability 只回 ack）。 */
  private applyRegistrySideEffects(method: string, args: unknown[], rt: Runtime): void {
    switch (method) {
      case "panels.register": {
        const def = args[0] as { id: string; title: string };
        if (def?.id) rt.panels.set(def.id, { pluginId: rt.plugin.id, id: def.id, title: def.title, icon: (def as PluginPanelEntry).icon, component: (def as PluginPanelEntry).component, visible: true });
        this.pushPanels();
        break;
      }
      case "panels.open": {
        const id = String(args[0]);
        const p = rt.panels.get(id);
        if (p) {
          p.visible = true;
          this.pushPanels();
        }
        break;
      }
      case "panels.close": {
        rt.panels.delete(String(args[0]));
        this.pushPanels();
        break;
      }
      case "statusbar.setItem": {
        const id = String(args[0]);
        const def = (args[1] ?? {}) as PluginStatusItem;
        rt.statusItems.set(id, { pluginId: rt.plugin.id, id, text: def.text ?? "", tooltip: def.tooltip, kind: def.kind });
        this.pushStatusbar();
        break;
      }
      case "statusbar.remove": {
        rt.statusItems.delete(String(args[0]));
        this.pushStatusbar();
        break;
      }
      case "bus.publish": {
        const [topic, payload] = args;
        for (const other of this.runtimes.values()) {
          if (other !== rt && other.status === "running") other.proc?.postMessage({ type: "event", topic: String(topic), payload });
        }
        break;
      }
    }
  }

  private reply(rt: Runtime, id: number, ok: boolean, value?: unknown, error?: string): void {
    rt.proc?.postMessage({ type: "result", id, ok, value, error });
  }

  private onLog(rt: Runtime, kind: "info" | "error", chunk: Buffer): void {
    const text = chunk.toString("utf-8").replace(/\s+$/, "").slice(0, LOG_LINE_CAP);
    if (!text) return;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      if (rt.activity.length < ACTIVITY_CAP + 20) this.addActivity(rt, "log", line.trim());
      // 转发到主进程控制台，便于日志排查（不 pushStatus，避免刷屏）
      (kind === "error" ? console.error : console.log)(`[plugin:${rt.plugin.id}] ${line}`);
    }
  }

  private onExit(rt: Runtime, code: number): void {
    rt.proc = undefined;
    rt.pid = undefined;
    if (rt.stoppingIntentionally) {
      rt.panels.clear();
      rt.statusItems.clear();
      this.pushPanels();
      this.pushStatusbar();
      rt.status = rt.plugin.enabled ? "stopped" : "disabled";
      this.pushStatus();
      return;
    }
    const uptime = Date.now() - rt.startedAt;
    rt.lastCrashAt = Date.now();
    rt.lastError = `进程异常退出（码 ${code}）`;
    if (uptime > STABLE_UPTIME_MS) rt.restarts = 0;
    this.addActivity(rt, "crash", `${rt.lastError}；本次存活 ${Math.max(0, Math.round(uptime / 1000))}s`);
    console.warn(`[plugin:${rt.plugin.id}] crashed code=${code} uptime=${uptime}ms restarts=${rt.restarts}`);
    if (rt.restarts < MAX_RESTARTS) {
      rt.restarts += 1;
      const delay = RESTART_BASE_MS * rt.restarts;
      rt.status = "restarting";
      this.addActivity(rt, "restart", `自动重启中（第 ${rt.restarts}/${MAX_RESTARTS} 次，${delay}ms 后）`);
      // 验收硬指标①：崩溃通知 + 自动重启
      this.services.ui.notify(`插件「${rt.plugin.displayName}」崩溃（退出码 ${code}），正在自动重启 ${rt.restarts}/${MAX_RESTARTS}`, "warning");
      rt.restartTimer = setTimeout(() => this.fork(rt), delay);
      this.pushStatus();
    } else {
      rt.status = "crashed";
      this.addActivity(rt, "crash", `反复崩溃，已停止自动重启`);
      this.services.ui.notify(`插件「${rt.plugin.displayName}」反复崩溃，已停止自动重启`, "error");
      this.pushStatus();
    }
  }

  setEnabled(id: string, enabled: boolean): void {
    const rt = this.runtimes.get(id);
    this.services.persistEnabled(id, enabled);
    if (!rt) {
      this.loadAndStart();
      return;
    }
    rt.plugin.enabled = enabled;
    if (enabled) {
      rt.restarts = 0;
      this.fork(rt);
    } else {
      this.stop(rt);
      rt.status = "disabled";
      this.pushStatus();
    }
  }

  restart(id: string): void {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    if (!rt.plugin.enabled) rt.plugin.enabled = true;
    rt.restarts = 0;
    this.stop(rt);
    setTimeout(() => this.fork(rt), 150);
  }

  /** 触发演示：向目标插件下发控制消息（crash → 自我硬崩；overreach → 越权调用）。 */
  demo(kind: "crash" | "overreach"): boolean {
    const target = kind === "crash" ? "demo-crash" : "demo-overreach";
    const rt = this.runtimes.get(target);
    if (!rt) return false;
    if (rt.status !== "running") {
      if (!rt.plugin.enabled) this.setEnabled(target, true);
      else this.restart(target);
      // 等 ready 后再发；用一次性轮询
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (rt.status === "running") {
          rt.proc?.postMessage({ type: "control", name: kind });
          clearInterval(iv);
        } else if (Date.now() - t0 > 3000) {
          clearInterval(iv);
        }
      }, 100);
      return true;
    }
    rt.proc?.postMessage({ type: "control", name: kind });
    return true;
  }

  private stop(rt: Runtime): void {
    if (rt.restartTimer) {
      clearTimeout(rt.restartTimer);
      rt.restartTimer = undefined;
    }
    rt.stoppingIntentionally = true;
    try {
      rt.proc?.kill();
    } catch {
      /* 已退出 */
    }
  }

  // ---------- 状态快照与推送 ----------

  private toStatus(rt: Runtime): PluginStatus {
    return {
      id: rt.plugin.id,
      displayName: rt.plugin.displayName,
      version: rt.plugin.version,
      description: rt.plugin.description,
      author: rt.plugin.author,
      source: rt.plugin.source,
      permissions: rt.plugin.permissions,
      enabled: rt.plugin.enabled,
      status: rt.status,
      pid: rt.pid,
      restarts: rt.restarts,
      lastError: rt.lastError,
      lastCrashAt: rt.lastCrashAt,
      activity: rt.activity.slice(-ACTIVITY_CAP),
    };
  }

  statusList(): PluginStatus[] {
    return [...this.runtimes.values()].map((rt) => this.toStatus(rt));
  }

  private addActivity(rt: Runtime, kind: PluginActivity["kind"], text: string): void {
    rt.activity.push({ ts: Date.now(), kind, text });
    if (rt.activity.length > ACTIVITY_CAP + 40) rt.activity.splice(0, rt.activity.length - ACTIVITY_CAP);
  }

  private pushStatus(): void {
    this.services.sendToRenderer(PLUGIN_CHANNELS.status, this.statusList());
  }

  private pushPanels(): void {
    const all: PluginPanelEntry[] = [];
    for (const rt of this.runtimes.values()) for (const p of rt.panels.values()) all.push(p);
    this.services.sendToRenderer(PLUGIN_CHANNELS.panels, all);
  }

  private pushStatusbar(): void {
    const all: PluginStatusItem[] = [];
    for (const rt of this.runtimes.values()) for (const s of rt.statusItems.values()) all.push(s);
    this.services.sendToRenderer(PLUGIN_CHANNELS.statusbar, all);
  }
}
