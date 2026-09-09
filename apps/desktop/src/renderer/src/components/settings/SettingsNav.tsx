import { Icon } from "../ui/Icon";
import { cn } from "@/lib/utils";
import { settingsGroups, type SettingsSectionId } from "./settings-sections";

/**
 * 设置页左侧导航：返回应用 + 分组大项。
 * 窄窗（<900px）收成图标栏：label 走 sr-only，栏宽 w-60 → w-14。
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
  const topPad = window.pi.platform === "darwin" ? "pt-[52px]" : "pt-4";
  return (
    <aside
      className={cn(
        "app-no-drag flex shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/60 bg-surface-chrome px-2 pb-4",
        topPad,
        "w-60 max-[900px]:w-14",
      )}
    >
      <button
        type="button"
        onClick={onClose}
        className="mb-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Icon name="arrowLeft" className="size-4" />
        <span className="max-[900px]:sr-only">返回应用</span>
      </button>

      {settingsGroups.map((group) => (
        <div key={group.label} className="mb-1">
          <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground/70 max-[900px]:sr-only">{group.label}</div>
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
              <span className="truncate max-[900px]:sr-only">{item.label}</span>
            </button>
          ))}
        </div>
      ))}
    </aside>
  );
}
