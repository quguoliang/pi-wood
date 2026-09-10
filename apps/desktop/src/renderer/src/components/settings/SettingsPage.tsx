import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "../../stores/settings-store";
import { SettingsNav } from "./SettingsNav";
import { settingsGroups, settingsSectionLabel, type SettingsSectionId } from "./settings-sections";
import { ProvidersSection } from "./sections/ProvidersSection";
import { ModelSection } from "./sections/ModelSection";
import { ApprovalSection } from "./sections/ApprovalSection";
import { ThemeSection } from "./sections/ThemeSection";
import { UiSection } from "./sections/UiSection";
import { ExtSection, type PkgInstallState } from "./sections/ExtSection";
import { PluginsPanel } from "../center/PluginsPanel";
import { SubagentPermissionsPanel } from "../center/SubagentPermissionsPanel";
import { MemorySettingsPanel } from "../center/MemorySettingsPanel";
import { UsageSettingsPanel } from "../center/UsageSettingsPanel";
import { ArchiveSettingsPanel } from "../center/ArchiveSettingsPanel";
import { WorktreeSettingsPanel } from "../center/WorktreeSettingsPanel";

const allIds = settingsGroups.flatMap((g) => g.items).map((i) => i.id);
const isSectionId = (v: unknown): v is SettingsSectionId => typeof v === "string" && (allIds as string[]).includes(v);

/**
 * 设置页（替代旧 SettingsModal 的全窗口覆盖层）。
 *
 * 层级与窗口 chrome（关键约束，参考 AppShell 同类踩坑注释）：
 * - z-20：低于红绿灯/Windows 控件（z-30）与绿键平铺菜单（z-40），窗口控制永远可点；
 * - 顶部 44px 为 app-drag 移窗带，且必须避开原生控件区——macOS 红绿灯在左（left-[26px]，
 *   带宽到 ~90px），Windows 控件在右（right-2 起 ~140px）。可拖区按 DOM 顺序累积，
 *   本页渲染在 AppShell 之后：拖拽带若压过控件区会把先渲染的 no-drag 按钮盖掉。
 *
 * 底层 AppShell 不卸载：面板尺寸/折叠态/流式会话原地保留，返回零成本。
 * 包安装（长任务）状态提升到本层：ExtSection 切页卸载也不丢进度与输出。
 */
export function SettingsPage({ onClose }: { onClose: () => void }): React.JSX.Element {
  const lastSection = useSettingsStore((s) => s.settings.ui.lastSection);
  const [section, setSection] = useState<SettingsSectionId>(() => (isSectionId(lastSection) ? lastSection : "theme"));

  const select = (id: SettingsSectionId): void => {
    setSection(id);
    void useSettingsStore.getState().patch({ ui: { lastSection: id } });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // —— 提升的包安装状态（切页不丢；promise 回调持本层 setter，卸载期间照常收敛）——
  const [install, setInstall] = useState<PkgInstallState>({ spec: "", output: "", running: false });
  const installPackage = useCallback((): void => {
    const spec = install.spec.trim();
    if (!spec || install.running) return;
    setInstall((s) => ({ ...s, output: "安装中（经 pi CLI，最长 2 分钟）…", running: true }));
    void window.pi
      .packagesInstall(spec)
      .then((r) => setInstall((s) => ({ ...s, spec: "", output: r.output || "完成", running: false })))
      .catch((err) => setInstall((s) => ({ ...s, output: String((err as Error)?.message ?? err), running: false })));
  }, [install.spec, install.running]);

  return (
    <div className="fixed inset-0 z-20 flex animate-in fade-in-0 duration-200 bg-surface-chrome" role="region" aria-label="设置">
      <div
        aria-hidden
        className={cn(
          "app-drag absolute top-0 h-11",
          window.pi.platform === "darwin" ? "left-[110px] right-0" : "left-0 right-[150px]",
        )}
      />
      <SettingsNav section={section} onPick={select} onClose={onClose} />
      {/* 内容区对齐主界面：外层 p-1.5 让 chrome（磨砂）在卡片四边留白，内层圆角描边卡片浮起 */}
      <div className="app-drag flex min-w-0 flex-1 p-1.5">
        <main className="app-no-drag min-w-0 flex-1 overflow-y-auto rounded-lg border border-border/60 bg-surface-app">
        {/* 模型源是双栏布局（供应商清单 + 表单），比单列表页吃宽；其余 section 维持 3xl 阅读宽度 */}
        <div className={cn("mx-auto px-10 pb-16 pt-14", section === "providers" ? "max-w-5xl" : "max-w-3xl")}>
          <h1 key={section} className="mb-6 animate-in fade-in-0 slide-in-from-bottom-1 duration-150 text-2xl font-semibold tracking-tight">
            {settingsSectionLabel(section)}
          </h1>
          <div key={`body-${section}`} className="animate-in fade-in-0 duration-150">
            {section === "providers" && <ProvidersSection />}
            {section === "model" && <ModelSection />}
            {section === "approval" && <ApprovalSection />}
            {section === "theme" && <ThemeSection />}
            {section === "ui" && <UiSection />}
            {section === "ext" && (
              <ExtSection install={install} onSpecChange={(spec) => setInstall((s) => ({ ...s, spec }))} onInstall={installPackage} />
            )}
            {section === "plugins" && <PluginsPanel />}
            {section === "subagent" && <SubagentPermissionsPanel />}
            {section === "memory" && <MemorySettingsPanel />}
            {section === "usage" && <UsageSettingsPanel />}
            {section === "archive" && <ArchiveSettingsPanel />}
            {section === "worktree" && <WorktreeSettingsPanel />}
          </div>
        </div>
        </main>
      </div>
    </div>
  );
}
