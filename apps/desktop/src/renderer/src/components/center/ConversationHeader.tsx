import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Icon } from "../ui/Icon";
import { useSessionStore } from "../../stores/session-store";
import { useSettingsStore } from "../../stores/settings-store";

/**
 * 中栏顶部 header：展示当前对话标题（取首条用户消息，与会话列表 firstMessage 同源），
 * 右侧承载两枚视图开关——运行时信息看板（EnvironmentPanel）、右侧工作台。
 * 右侧工作台按钮遵循"就近"规则：右栏收起时显示在此处最右侧（点开），
 * 右栏展开时改由 RightPane 自身头部提供收起按钮（此处隐藏）。
 */
export function ConversationHeader({
  environmentOpen,
  onEnvironmentToggle,
}: {
  environmentOpen: boolean;
  onEnvironmentToggle(): void;
}): React.JSX.Element {
  const title = useSessionStore((s) => {
    const first = s.items.find((item) => item.kind === "user");
    return first && first.kind === "user" ? first.text.replace(/\s+/g, " ").trim() : "";
  });
  const activeProject = useSessionStore((s) => s.activeProject);
  const rightCollapsed = useSettingsStore((s) => Boolean(s.settings.window.rightCollapsed));

  const projectName = activeProject?.split(/[\\/]/).filter(Boolean).pop();
  const display = title || projectName || "新任务";

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3">
      <Icon name="message" className="size-4 shrink-0 text-muted-foreground" />
      <h1 className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground" title={display}>
        {display}
      </h1>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn("text-muted-foreground hover:text-foreground", environmentOpen && "bg-accent text-accent-foreground")}
          onClick={onEnvironmentToggle}
          aria-label="显示或隐藏运行时信息"
        >
          <Icon name="panelTop" />
        </Button>
        {rightCollapsed && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => window.dispatchEvent(new Event("piwood:toggle-inspector"))}
            aria-label="展开右侧工作台"
          >
            <Icon name="panelRight" />
          </Button>
        )}
      </div>
    </header>
  );
}
