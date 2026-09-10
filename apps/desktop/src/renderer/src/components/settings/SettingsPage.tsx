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
 * - 移窗带必须由「app-drag 容器 + 内嵌 no-drag 交互项」构成，不能用一个绝对定位的 app-drag 浮层：
 *   ① 浮层是定位元素，绘制层级高于静态的导航/卡片，会直接把「返回应用」的点击吃掉（点了没反应）；
 *   ② 可拖拽区域按 DOM 顺序累积，浮层先渲染，后渲染的 no-drag（导航栏、卡片）会把它的移窗区抵消掉，
 *      结果整个顶部既点不动也拖不动。故本页顶部两栏各自内嵌一条 app-drag 条带（同 LeftPane /
 *      ConversationHeader 的「no-drag 容器内嵌 drag 条带」格式）。
 * - 条带必须避开原生控件区——macOS 红绿灯在左（窗口 x 26~82），Windows 控件在右（右起 ~96px）。
 *   本页整体渲染在 AppShell 之后，条带按 DOM 顺序会把窗口控件区的 no-drag 重新盖成 drag，
 *   故右侧条带几何上让出控件宽度。
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

  const isMac = window.pi.platform === "darwin";

  return (
    <div className="fixed inset-0 z-20 flex animate-in fade-in-0 duration-200 bg-surface-chrome" role="region" aria-label="设置">
      <SettingsNav section={section} onPick={select} onClose={onClose} />
      {/* 内容区对齐主界面：外层 p-1.5 让 chrome（磨砂）在卡片四边留白，内层圆角描边卡片浮起 */}
      <div className="app-drag flex min-w-0 flex-1 p-1.5">
        <main className="app-no-drag flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/60 bg-surface-app">
          {/* 卡片自身 no-drag，顶部 44px 移窗带靠内部 drag 子元素加回（同 ConversationHeader 模式）。
              Windows 右上角是 AppShell 的窗口控件（z-30，在本页之前渲染），本页整体渲染在其后，
              条带按 DOM 顺序会把控件区的 no-drag 重新盖成 drag → 右端让出控件宽度（含间隙余量）。 */}
          <div aria-hidden className={cn("app-drag h-11 shrink-0", !isMac && "mr-[144px]")} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* 模型源是双栏布局（供应商清单 + 表单），比单列表页吃宽；其余 section 维持 3xl 阅读宽度。
                band(44px) + pt-3(12px) = 原 pt-14(56px)，标题纵向位置不变 */}
            <div className={cn("mx-auto px-10 pb-16 pt-3", section === "providers" ? "max-w-5xl" : "max-w-3xl")}>
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
          </div>
        </main>
      </div>
    </div>
  );
}
