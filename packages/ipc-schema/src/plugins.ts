import { z } from "zod";
import { PLUGIN_PERMISSIONS, type PluginPermission } from "@pi-wood/plugin-api";

/**
 * 桌面插件系统（T5.2，方案 §6）IPC 契约 —— 主进程 PluginHost ↔ 渲染层管理 UI 的唯一事实源。
 * 权限令牌直接复用 @pi-wood/plugin-api 的 PLUGIN_PERMISSIONS，避免枚举漂移。
 *
 * 注意：插件的 notify / ui.confirm/select/input 复用引擎已有的 `ui:notify` / `ui:request` /
 * `ui:respond` 通道（见 engine-manager 的 uiBridge），不在此另立通道；window.* 直接在主进程
 * 操作 BrowserWindow。因此下面只列「插件状态/管理」与「面板/状态栏/打开文件」这三类渲染层承接面。
 */

export const PluginPermissionSchema = z.enum(
  PLUGIN_PERMISSIONS as unknown as [PluginPermission, ...PluginPermission[]],
);

/** 插件生命周期状态。 */
export const PluginStatusEnumSchema = z.enum([
  "disabled", // settings 里被显式关掉
  "stopped", // 有入口但未启动（尚未 fork）
  "starting", // utilityProcess 已 fork、等 ready 握手
  "running", // 已 ready，可收发 RPC
  "crashed", // 进程异常退出（等自动重启或已达上限）
  "restarting", // 崩溃后重启中
]);
export type PluginLifecycleStatus = z.infer<typeof PluginStatusEnumSchema>;

/** 一条可视活动（API 调用 / 权限拒绝 / 崩溃 / 重启 / 运行时确认 / 通知），供管理 UI 展示。 */
export const PluginActivitySchema = z.object({
  ts: z.number(),
  kind: z.enum(["call", "denied", "crash", "restart", "confirm", "notify", "log", "info"]),
  text: z.string(),
});
export type PluginActivity = z.infer<typeof PluginActivitySchema>;

/** 单个插件在主进程侧的完整状态快照（push 给渲染层）。 */
export const PluginStatusSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  version: z.string(),
  description: z.string().optional(),
  author: z.string().optional(),
  source: z.enum(["bundled", "user"]),
  permissions: z.array(PluginPermissionSchema),
  enabled: z.boolean(),
  status: PluginStatusEnumSchema,
  pid: z.number().optional(),
  restarts: z.number(),
  lastError: z.string().optional(),
  lastCrashAt: z.number().optional(),
  activity: z.array(PluginActivitySchema),
});
export type PluginStatus = z.infer<typeof PluginStatusSchema>;

/** 插件经 panels.register 注册、由渲染层承载的面板条目。 */
export const PluginPanelEntrySchema = z.object({
  pluginId: z.string(),
  id: z.string(),
  title: z.string(),
  icon: z.string().optional(),
  component: z.enum(["webview", "text"]).optional(),
  visible: z.boolean().optional(),
});
export type PluginPanelEntry = z.infer<typeof PluginPanelEntrySchema>;

/** 插件经 statusbar.setItem 注册的状态栏条目。 */
export const PluginStatusItemSchema = z.object({
  pluginId: z.string(),
  id: z.string(),
  text: z.string(),
  tooltip: z.string().optional(),
  kind: z.enum(["default", "info", "success", "warning", "error"]).optional(),
});
export type PluginStatusItem = z.infer<typeof PluginStatusItemSchema>;

export const PLUGIN_CHANNELS = {
  // 渲染层 → 主进程（invoke）
  list: "plugins:list",
  setEnabled: "plugins:setEnabled",
  restart: "plugins:restart",
  reload: "plugins:reload",
  /** 触发崩溃/越权演示（kind: 'crash' | 'overreach'） */
  demo: "plugins:demo",
  // 主进程 → 渲染层（send）
  status: "plugins:status",
  /** 插件请求编辑器打开文件 → 渲染层 openWorkbenchFile(path) */
  openFile: "plugins:openFile",
  /** 面板注册表全量快照（register/close 后推） */
  panels: "plugins:panels",
  /** 状态栏注册表全量快照（setItem/remove 后推） */
  statusbar: "plugins:statusbar",
} as const;
