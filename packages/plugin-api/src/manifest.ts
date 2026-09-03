/**
 * pi-wood 桌面插件 manifest（方案 §6.1）。
 *
 * 一个 pi-wood 插件 = 一个含 `piwood-plugin.json` 的目录。`pi.desktop.entry` 指向
 * 一个由主进程经 Electron `utilityProcess` 拉起的独立进程入口（.cjs/.mjs/.js）。
 * 运行时能力全部经 `pi.desktop.permissions` 白名单授权（§6.2）；未声明的 API 一律拒绝。
 *
 * 本文件是「纯类型 + 数据」，不依赖 electron/node，供主进程、渲染层、插件三方共用。
 */

/**
 * 权限令牌。§6.1 原始清单（fs/terminal/network/browser/editor/notify/bus/agentTool/window）
 * + 运行时注册面板/状态栏所需的 `panels`、`statusbar`（对方案的一点补充，见 §8 决策）。
 */
export const PLUGIN_PERMISSIONS = [
  "fs:read",
  "fs:write",
  "terminal:run",
  "network:fetch",
  "browser:navigate",
  "editor:open",
  "notify",
  "bus:*",
  "agentTool:invoke",
  "window:control",
  "panels",
  "statusbar",
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

/** 注册到工作台的一块面板（渲染层承载，见 PluginsPanel 与 plugin-store）。 */
export interface PanelDefinition {
  id: string;
  title: string;
  /** lucide 图标名，可选 */
  icon?: string;
  /** 渲染层组件标识（当前宿主仅内置 'webview' | 'text' 两种演示承载） */
  component?: "webview" | "text";
  /** 初始可见 */
  visible?: boolean;
}

/** 状态栏条目。 */
export interface StatusItem {
  id: string;
  text: string;
  tooltip?: string;
  /** 语义色，仅展示 */
  kind?: "default" | "info" | "success" | "warning" | "error";
}

/**
 * 插件清单（对应 npm 包 `pi` 字段的桌面子集 + pi-wood 本地插件格式）。
 * pi-wood 本地插件目录里的 `piwood-plugin.json` 直接就是本对象（无 `pi` 外层也可）。
 */
export interface PiPackageManifest {
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  author?: string;
  pi?: {
    extensions?: string[];
    skills?: string[];
    prompts?: string[];
    themes?: string[];
    desktop?: PiDesktopManifest;
  };
}

export interface PiDesktopManifest {
  /** utilityProcess 入口（相对 manifest 所在目录），必填才有桌面侧 */
  entry?: string;
  panels?: PanelDefinition[];
  permissions?: PluginPermission[];
}

/** 宿主加载后规整出的插件描述（entry 绝对路径 + 来源 + 声明）。 */
export interface LoadedPlugin {
  /** manifest.name */
  id: string;
  displayName: string;
  version: string;
  description?: string;
  author?: string;
  /** 绝对入口文件路径（utilityProcess.fork 的目标） */
  entryPath: string;
  /** manifest 所在目录绝对路径（用于 fs 相对解析与展示） */
  dir: string;
  /** 声明的权限（去重、仅保留合法令牌） */
  permissions: PluginPermission[];
  /** 预声明的面板 */
  panels: PanelDefinition[];
  /** 来源：bundled（内置示例目录）/ user（~/.pi-wood/plugins） */
  source: "bundled" | "user";
  /** 是否已在 settings.pluginsEnabled 中被显式禁用（缺省视为启用） */
  enabled: boolean;
}

export const PIWOOD_MANIFEST_FILE = "piwood-plugin.json";
