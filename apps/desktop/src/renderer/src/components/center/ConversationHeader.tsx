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
  // 窗口态收起左栏时，开关需要预留左侧空间（macOS 另有红绿灯共 128px）；全屏无自绘灯，占位收掉、图标左移
  const reserve = leftCollapsed && !fullScreen;
  // Windows 自绘窗口控制悬浮在窗口右上角（AppShell z-30）：仅右栏收起时（控制落在本 header 上方）才需要让位
  const isWindows = window.pi.platform === "win32";

  const projectName = activeProject?.replace(/[\\/]+$/, "").endsWith(".pi-wood/chats")
    ? "最近"
    : activeProject?.split(/[\\/]/).filter(Boolean).pop();
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
    <header
      className={cn(
        // padding 过渡与面板几何同一曲线：折叠联动 pl/pr 换挡时标题平滑滑移而非瞬跳
        "app-drag relative flex h-11 shrink-0 select-none items-center gap-2 border-b border-border/60 pl-8 pr-6 transition-[padding] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
        // Windows 无红绿灯，收起态让位只需容纳左移的接力开关
        reserve && (isWindows ? "pl-[48px]" : "pl-[128px]"),
        leftCollapsed && fullScreen && (isWindows ? "pl-[48px]" : "pl-[56px]"),
        isWindows && rightCollapsed && "pr-[104px]",
      )}
    >
      {leftCollapsed && (
        /* 左栏收起后开关接力点：窗口坐标与展开态 LeftPane 顶栏开关完全一致（x=8/92、中心 y=24），
           展开↔收起切换时图标零位移才不抖。header 在卡片内（卡距窗 6px），故左值 = 展开态 x - 6 */
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(
            "app-no-drag absolute z-10 text-muted-foreground hover:text-foreground active:scale-100!",
            isWindows ? "left-[2px] top-[4px]" : fullScreen ? "left-2 top-[4px]" : "left-[86px] top-[4px]",
          )}
          onClick={() => window.dispatchEvent(new Event("piwood:toggle-sidebar"))}
          aria-label="展开或收起项目栏"
        >
          <Icon name="sidebar" size={15} />
        </Button>
      )}
      <h1 className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground" title={display}>
        {display}
      </h1>
      <div className="app-no-drag flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn("text-muted-foreground hover:text-foreground", environmentOpen && "bg-accent text-accent-foreground")}
          onClick={onEnvironmentToggle}
          aria-label="显示或隐藏运行时信息"
        >
          <Icon name="panelTop" />
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
        {/* 右栏展开时入口在 RightPane nav/空头条最右（用户裁定不双入口），收起时才在此显示展开按钮。
            必须排最右：与 RightPane 收起钮的窗口 x 坐标一致（同 pr-[104px] 预留、同 h-11 中线），切换零位移 */}
        {rightCollapsed && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground animate-in fade-in-0 duration-200 [animation-fill-mode:both]"
            onClick={() => window.dispatchEvent(new Event("piwood:toggle-inspector"))}
            aria-label="展开右侧工作台"
            title="展开右侧工作台"
          >
            <Icon name="panelRight" />
          </Button>
        )}
      </div>
    </header>
  );
}
