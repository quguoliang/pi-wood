import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Icon } from "../ui/Icon";
import { useActiveConversation, useSessionStore } from "../../stores/session-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useFullScreen } from "../../hooks/use-fullscreen";
import { buildExportFilename, formatSessionAsMarkdown } from "../../lib/export-session";

/**
 * 中栏顶部 header：展示当前对话标题（取首条用户消息，与会话列表 firstMessage 同源），
 * 右侧承载视图开关——运行时信息看板（EnvironmentPanel），
 * 以及 T7.3「…」会话操作菜单（导出为 Markdown）。
 * （原「自动接受」开关已并入 composer 盾牌「Agent 权限」下拉，见 use-composer-controller.changeApproval。）
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
  const title = useActiveConversation((c) => {
    const first = c.items.find((item) => item.kind === "user");
    return first && first.kind === "user" ? first.text.replace(/\s+/g, " ").trim() : "";
  });
  const items = useActiveConversation((c) => c.items);
  const activeProject = useSessionStore((s) => s.activeProject);
  const rightCollapsed = useSettingsStore((s) => Boolean(s.settings.window.rightCollapsed));
  const leftCollapsed = useSettingsStore((s) => Boolean(s.settings.window.leftCollapsed));
  const fullScreen = useFullScreen();
  // 窗口态收起左栏时，红绿灯+开关需要预留 128px；全屏无自绘灯，占位收掉、图标左移
  const reserve = leftCollapsed && !fullScreen;

  const projectName = activeProject?.split(/[\\/]/).filter(Boolean).pop();
  const display = title || projectName || "新任务";

  const onExportMarkdown = async (): Promise<void> => {
    if (items.length === 0) return;
    try {
      const fileName = buildExportFilename(display);
      const savedPath = await window.pi.exportSessionMarkdown(fileName, formatSessionAsMarkdown(items, display));
      if (!savedPath) {
        toast.info("已取消导出");
        return;
      }
      toast.success(`已导出：${savedPath.split(/[\\/]/).pop() ?? savedPath}`);
    } catch (err) {
      toast.error(`导出失败：${String((err as Error)?.message ?? err)}`);
    }
  };

  return (
    <header className={cn("relative flex h-11 shrink-0 items-center gap-2 border-b border-border/60 pl-8 pr-6", reserve && "pl-[128px]", leftCollapsed && fullScreen && "pl-[56px]")}>
      {leftCollapsed && window.pi.platform !== "win32" && (
        /* 左栏收起后开关接力点：窗口态与展开态同坐标 x=92（避开灯位）；全屏无灯，靠左缘 */
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn("absolute top-1/2 z-10 -translate-y-1/2 text-muted-foreground hover:text-foreground active:scale-100!", fullScreen ? "left-[8px]" : "left-[88px]")}
          onClick={() => window.dispatchEvent(new Event("piwood:toggle-sidebar"))}
          aria-label="展开或收起项目栏"
        >
          <Icon name="sidebar" size={15} />
        </Button>
      )}
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
        {/* 常显：若只按 rightCollapsed 条件渲染，右栏被拖窄/状态不同步时会出现
            Header 无按钮、RightPane 又看不见的双死锁——常显保证任何状态都有入口 */}
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn("text-muted-foreground hover:text-foreground", !rightCollapsed && "bg-accent text-accent-foreground")}
          onClick={() => window.dispatchEvent(new Event("piwood:toggle-inspector"))}
          aria-label={rightCollapsed ? "展开右侧工作台" : "收起右侧工作台"}
          title={rightCollapsed ? "展开右侧工作台" : "收起右侧工作台"}
        >
          <Icon name="panelRight" />
        </Button>
        {items.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label="会话操作">
                <Icon name="ellipsis" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem onSelect={() => void onExportMarkdown()}>
                <Icon name="file" className="size-4" />
                导出为 Markdown
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
