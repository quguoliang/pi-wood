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
import { buildExportFilename, formatSessionAsMarkdown } from "../../lib/export-session";

/**
 * 中栏顶部 header：展示当前对话标题（取首条用户消息，与会话列表 firstMessage 同源），
 * 右侧承载视图开关——运行时信息看板（EnvironmentPanel）、右侧工作台、T7.2 会话级「自动接受审批」，
 * 以及 T7.3「…」会话操作菜单（导出为 Markdown）。
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
  const currentSessionId = useActiveConversation((c) => c.currentSessionId);
  const engineReady = useActiveConversation((c) => c.engineReady);
  const rightCollapsed = useSettingsStore((s) => Boolean(s.settings.window.rightCollapsed));
  const autoAccept = useSettingsStore(
    (s) => Boolean(currentSessionId && s.settings.autoAcceptSessions?.[currentSessionId]),
  );

  const projectName = activeProject?.split(/[\\/]/).filter(Boolean).pop();
  const display = title || projectName || "新任务";

  const onToggleAutoAccept = async (): Promise<void> => {
    if (!currentSessionId) return;
    const next = !autoAccept;
    await useSettingsStore.getState().patch({ autoAcceptSessions: { [currentSessionId]: next } });
    if (next) await window.pi.approvalAcceptAll().catch(() => undefined);
    toast(next ? "本会话已开启自动接受审批（denyAll/敏感路径仍拦截）" : "本会话已关闭自动接受审批");
  };

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
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3">
      <Icon name="message" className="size-4 shrink-0 text-muted-foreground" />
      <h1 className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground" title={display}>
        {display}
      </h1>
      <div className="flex shrink-0 items-center gap-1">
        {engineReady && currentSessionId && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "gap-1.5 text-muted-foreground hover:text-foreground",
              autoAccept && "bg-success/15 text-success hover:bg-success/20 hover:text-success",
            )}
            onClick={() => void onToggleAutoAccept()}
            aria-pressed={autoAccept}
            title="本会话自动接受工具审批；denyAll 策略与敏感路径仍会拦截"
          >
            <Icon name="shield" className="size-3.5" />
            <span className="text-xs">自动接受</span>
          </Button>
        )}
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
