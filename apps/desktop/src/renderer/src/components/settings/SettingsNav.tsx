import { Icon } from "../ui/Icon";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "../../stores/settings-store";
import { settingsGroups, type SettingsSectionId } from "./settings-sections";

/**
 * 设置页左侧导航：返回应用 + 分组大项。
 * 宽度对齐主界面侧栏：读同一份持久化 layout[0]（占窗宽百分比），用与主侧栏 Panel 相同的
 * clamp(200px, l%, 280px) 规则，保证两栏宽度一致、且跟随用户在主界面拖拽的宽度。
 *
 * 顶部移窗带（与 LeftPane 同构，双平台无全宽顶栏）：
 * - 本栏整体 app-no-drag（列表要能点），故顶栏必须内嵌 app-drag 条带把移窗区加回来——
 *   反过来用绝对定位浮层覆盖，会既吃掉「返回应用」的点击、又被本栏 no-drag 抵消掉移窗区；
 * - 「返回应用」作为 no-drag 后代嵌在条带内（Electron 可靠模式），点击与拖窗互不干扰；
 * - 条带不参与滚动（列表单独滚动），否则滚动后移窗带会被推走。
 * - macOS 红绿灯悬浮在本栏上方（AppShell z-30）：拖拽区会吞非后代元素的点击，
 *   在灯占位（窗口 x 26~82）打 no-drag 洞后点击才能落到灯上；Windows 无左侧控件正常 padding。
 */
export function SettingsNav({
  section,
  onPick,
  onClose,
}: {
  section: SettingsSectionId;
  onPick: (id: SettingsSectionId) => void;
  onClose: () => void;
}): React.JSX.Element {
  const l = useSettingsStore((s) => s.settings.window.layout[0]);
  const isMac = window.pi.platform === "darwin";
  return (
    <aside
      style={{ width: `min(280px, max(200px, ${l}%))` }}
      className="app-no-drag flex shrink-0 flex-col overflow-hidden bg-surface-chrome pb-4"
    >
      {/* 条带全宽（水平 padding 下沉到内部），左缘也能拖窗 */}
      <div className={cn("app-drag relative shrink-0 px-2", isMac ? "pt-[52px]" : "pt-4")}>
        {isMac && (
          /* 红灯绿灯占位（窗口 x 18~90）：条带全宽，故用窗口坐标 */
          <span aria-hidden="true" className="app-no-drag pointer-events-none absolute inset-y-0 left-[18px] w-[72px]" />
        )}
        <button
          type="button"
          onClick={onClose}
          className="app-no-drag mb-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Icon name="arrowLeft" className="size-4" />
          <span>返回应用</span>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2">
        {settingsGroups.map((group) => (
          <div key={group.label} className="mb-1">
            <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground/70">{group.label}</div>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onPick(item.id)}
                title={item.label}
                aria-current={section === item.id ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                  section === item.id
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <Icon name={item.icon} className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
