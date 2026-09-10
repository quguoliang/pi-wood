import { Icon } from "../ui/Icon";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "../../stores/settings-store";
import { settingsGroups, type SettingsSectionId } from "./settings-sections";

/**
 * 设置页左侧导航：返回应用 + 分组大项。
 * 宽度对齐主界面侧栏：读同一份持久化 layout[0]（占窗宽百分比），用与主侧栏 Panel 相同的
 * clamp(200px, l%, 280px) 规则，保证两栏宽度一致、且跟随用户在主界面拖拽的宽度。
 * 顶部留出 macOS 红绿灯高度（pt-[52px]），Windows 无左侧控件正常 padding。
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
  const topPad = window.pi.platform === "darwin" ? "pt-[52px]" : "pt-4";
  return (
    <aside
      style={{ width: `min(280px, max(200px, ${l}%))` }}
      className={cn(
        "app-no-drag flex shrink-0 flex-col gap-0.5 overflow-y-auto bg-surface-chrome px-2 pb-4",
        topPad,
      )}
    >
      <button
        type="button"
        onClick={onClose}
        className="mb-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Icon name="arrowLeft" className="size-4" />
        <span>返回应用</span>
      </button>

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
    </aside>
  );
}
