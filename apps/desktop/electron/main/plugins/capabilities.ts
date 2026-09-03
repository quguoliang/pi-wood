import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, relative } from "node:path";
import { PLUGIN_CHANNELS } from "@pi-wood/ipc-schema";
import type { LoadedPlugin } from "@pi-wood/plugin-api";

/**
 * 插件能力代理（T5.2，方案 §6.3）。
 *
 * 关键不变量：插件进程不持有任何原生句柄，敏感能力（终端/浏览器/写文件/网络）全部由主进程
 * 在**已过权限门**的前提下代为执行。本模块只负责「已授权 → 做实事」，权限裁决在 PluginHost。
 */

/** 主进程注入的依赖，避免 capabilities 直接 import 各服务造成耦合/环。 */
export interface HostDeps {
  /** main → renderer 推送 */
  sendToRenderer(channel: string, data: unknown): void;
  /** 复用引擎的 ctx.ui 桥（同一条 ui:notify / ui:request 通道） */
  ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
    confirm(title: string, message: string): Promise<boolean>;
    select(title: string, options: string[]): Promise<string | undefined>;
    input(title: string, placeholder?: string): Promise<string | undefined>;
  };
  /** 当前活动项目目录（editor.openFile / terminal cwd 的相对基准与安全根） */
  getProjectDir(): string | undefined;
  /** 主窗口 setter（window.* 直接在主进程操作，不经渲染层） */
  window: {
    setTitle(title: string): void;
    setProgress(progress: number | null): void;
  };
  /** 浏览器代理（复用 T2.4 headless 浏览器服务的导出函数） */
  browser: {
    navigate(url: string): Promise<void>;
    screenshot(): Promise<string>;
  };
  /** agent 工具复用（best-effort：browser_* 路由到浏览器，其余留桩） */
  invokeAgentTool(name: string, args: unknown): Promise<unknown>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** 终端命令执行（方案 §6.3：主进程代理，插件不持 shell）。返回退出码。 */
function runCommand(cmd: string, cwd?: string, timeoutMs = 20000): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { shell: true, cwd: cwd || homedir(), env: process.env });
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        resolve(-1);
      }
    }, timeoutMs);
    child.stdout?.on("data", (b: Buffer) => process.stdout.write(`[plugin:term] ${b}`));
    child.stderr?.on("data", (b: Buffer) => process.stderr.write(`[plugin:term!] ${b}`));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code ?? -1);
    });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(-1);
    });
  });
}

/**
 * 把路径规整成渲染层 openWorkbenchFile 期望的形式：
 * 项目内的绝对路径 → 相对项目根；其余（已是相对/在项目外）→ 原样透传。
 */
function toEditorPath(deps: HostDeps, p: string): string {
  if (!p) return p;
  const root = deps.getProjectDir();
  if (root && isAbsolute(p) && p.startsWith(root)) {
    const rel = relative(root, p).split("\\").join("/");
    return rel || p;
  }
  return p;
}

export async function execCapability(method: string, args: unknown[], plugin: LoadedPlugin, deps: HostDeps): Promise<unknown> {
  switch (method) {
    case "panels.register":
    case "panels.open":
    case "panels.close":
      // 面板注册表由 PluginHost 维护并推快照；这里确认调用可达即可。
      return undefined;

    case "statusbar.setItem":
    case "statusbar.remove":
      return undefined;

    case "editor.openFile": {
      const path = toEditorPath(deps, str(args[0]));
      deps.sendToRenderer(PLUGIN_CHANNELS.openFile, { path, focus: (args[1] as { focus?: boolean })?.focus ?? true });
      return undefined;
    }

    case "terminal.run": {
      const cmd = str(args[0]);
      const opts = (args[1] ?? {}) as { cwd?: string };
      return await runCommand(cmd, opts.cwd);
    }

    case "browser.navigate":
      await deps.browser.navigate(str(args[0]));
      return undefined;

    case "browser.screenshot":
      return await deps.browser.screenshot();

    case "browser.goBack":
      deps.ui.notify(`插件「${plugin.displayName}」请求 browser.goBack（headless 版暂未实现返回上一步）`, "info");
      return undefined;

    case "diff.show": {
      // 尽力：打开「改动后」文件供查看；完整 diff 视图接宿主快照引擎留后续。
      const after = str(args[1]);
      if (after) deps.sendToRenderer(PLUGIN_CHANNELS.openFile, { path: toEditorPath(deps, after), focus: true });
      return undefined;
    }

    case "diff.revert":
      deps.ui.notify(`已请求还原 ${str(args[0])}（插件 diff.revert；快照还原接线预留）`, "warning");
      return undefined;

    case "notify": {
      const o = (args[0] ?? {}) as { title: string; body?: string; kind?: "info" | "success" | "warning" | "error" };
      const type = o.kind === "success" ? "info" : o.kind ?? "info";
      deps.ui.notify(`[${plugin.displayName}] ${o.title}${o.body ? ` — ${o.body}` : ""}`, type);
      return undefined;
    }

    case "ui.confirm": {
      const o = (args[0] ?? {}) as { title: string; body: string };
      return await deps.ui.confirm(o.title, o.body);
    }

    case "ui.select": {
      const o = (args[0] ?? {}) as { title?: string; options: unknown[]; render?: (t: unknown) => string };
      const opts = (o.options ?? []).map((x) => (o.render ? String(o.render(x)) : String(x)));
      const pick = await deps.ui.select(o.title ?? "请选择", opts);
      if (pick == null) return null;
      const idx = opts.indexOf(pick);
      return idx >= 0 ? (o.options ?? [])[idx] ?? null : pick;
    }

    case "ui.input": {
      const o = (args[0] ?? {}) as { title?: string; prompt: string; defaultValue?: string };
      const v = await deps.ui.input(o.prompt ?? o.title ?? "请输入", o.defaultValue);
      return v ?? null;
    }

    case "bus.publish":
      // PluginHost 负责向所有在飞插件广播 event 帧；此处仅确认调用成功。
      return undefined;

    case "bus.subscribe":
      // 订阅在插件进程内完成（createDesktopApi 本地登记），宿主无需处理。
      return undefined;

    case "window.setTitle":
      deps.window.setTitle(str(args[0]));
      return undefined;

    case "window.setProgress":
      deps.window.setProgress(num(args[0]));
      return undefined;

    case "invokeAgentTool":
      return await deps.invokeAgentTool(str(args[0]), args[1]);

    default:
      throw new Error(`未实现的能力：${method}`);
  }
}
