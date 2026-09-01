import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Icon } from "../ui/Icon";

/** 侧栏顶部导航（纯呈现）：新建任务/搜索/插件市场已接线；自动化为占位（disabled）。 */
export function SidebarNav({
  onNewTask,
  onSearch,
  onMarketplace,
}: {
  onNewTask(): void;
  onSearch(): void;
  onMarketplace(): void;
}): React.JSX.Element {
  return (
    <nav className="flex shrink-0 flex-col gap-0.5 px-2 pb-2 pt-2" aria-label="侧栏导航">
      <NavRow icon="add" label="新建任务" shortcut="Ctrl N" onSelect={onNewTask} />
      <NavRow icon="search" label="搜索" shortcut="Ctrl K" onSelect={onSearch} />
      <NavRow icon="play" label="自动化" disabled />
      <NavRow icon="browser" label="插件市场" onSelect={onMarketplace} />
    </nav>
  );
}

function NavRow({ icon, label, shortcut, disabled, onSelect }: { icon: "add" | "search" | "play" | "browser"; label: string; shortcut?: string; disabled?: boolean; onSelect?(): void }): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={onSelect}
      title={disabled ? "即将推出" : label}
      className={cn(
        "h-8 w-full justify-start gap-2.5 rounded-md px-2.5 text-[13px] font-normal text-sidebar-foreground/90 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        disabled && "opacity-45",
      )}
    >
      <Icon name={icon} className="size-4 text-muted-foreground" />
      <span>{label}</span>
      {shortcut && <span className="ml-auto text-[11px] tracking-wide text-muted-foreground/70">{shortcut}</span>}
    </Button>
  );
}
