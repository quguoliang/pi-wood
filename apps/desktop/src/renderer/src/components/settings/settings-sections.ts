import type { IconName } from "../ui/Icon";

/**
 * 设置页大项注册表（唯一来源）：分组导航与右内容区标题共用。
 * 分组口径参考 Codex 桌面版设置（通用/模型/Agent/扩展）。
 */
export type SettingsSectionId =
  | "theme"
  | "ui"
  | "providers"
  | "model"
  | "approval"
  | "usage"
  | "subagent"
  | "memory"
  | "worktree"
  | "archive"
  | "ext"
  | "plugins";

export interface SettingsSectionItem {
  id: SettingsSectionId;
  label: string;
  icon: IconName;
}

export const settingsGroups: Array<{ label: string; items: SettingsSectionItem[] }> = [
  {
    label: "通用",
    items: [
      { id: "theme", label: "主题", icon: "palette" },
      { id: "ui", label: "界面", icon: "sliders" },
    ],
  },
  {
    label: "模型",
    items: [
      { id: "providers", label: "模型源", icon: "key" },
      { id: "model", label: "默认模型", icon: "sparkles" },
      { id: "approval", label: "审批策略", icon: "shield" },
      { id: "usage", label: "用量", icon: "activity" },
    ],
  },
  {
    label: "Agent",
    items: [
      { id: "subagent", label: "子代理", icon: "bot" },
      { id: "memory", label: "记忆", icon: "brain" },
      { id: "worktree", label: "工作树", icon: "gitBranch" },
      { id: "archive", label: "归档", icon: "archive" },
    ],
  },
  {
    label: "扩展",
    items: [
      { id: "ext", label: "扩展与包", icon: "package" },
      { id: "plugins", label: "插件", icon: "puzzle" },
    ],
  },
];

export const settingsSectionLabel = (id: SettingsSectionId): string =>
  settingsGroups.flatMap((g) => g.items).find((item) => item.id === id)?.label ?? "设置";
