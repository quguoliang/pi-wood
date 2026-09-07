import { toast } from "sonner";
import { Icon } from "../ui/Icon";
import { useSessionStore } from "../../stores/session-store";
import { useConversationsStore } from "../../stores/conversations-store";
import { useSessionMetaStore } from "../../stores/session-meta-store";

/**
 * T9.2 v2.1「⑂ 从对话中派生」底部标识：
 * 消息级「分叉」产生的新会话（session-meta.forkedFrom 指到源会话文件）在底部居中显示本 chip，
 * 点击跳回源对话；源对话未开着时给出找回指引（左栏历史会话可恢复）。
 */
export function ForkedFromChip(): React.JSX.Element | null {
  const activeConversationId = useSessionStore((s) => s.activeConversationId);
  const rows = useConversationsStore((s) => s.rows);
  const firstUserById = useConversationsStore((s) => s.firstUserById);
  const meta = useSessionMetaStore((s) => s.meta);

  const self = activeConversationId ? rows.find((r) => r.id === activeConversationId) : undefined;
  const forkedFrom = self?.sessionFile ? meta[self.sessionFile]?.forkedFrom : undefined;
  if (!self || !forkedFrom) return null;

  const source = rows.find((r) => r.sessionFile === forkedFrom);
  const sourceTitle = source
    ? (meta[forkedFrom]?.alias ?? firstUserById[source.id] ?? "源对话").replace(/\s+/g, " ").trim().slice(0, 32)
    : undefined;

  const onClick = (): void => {
    if (source) {
      useConversationsStore.getState().switchTo(source.id, source.projectDir);
      return;
    }
    void toast.info("源对话当前没打开——在左栏项目下找到它点一下即可恢复");
  };

  return (
    <div className="flex shrink-0 justify-center pb-1">
      <button
        type="button"
        data-forked-from
        onClick={onClick}
        title={sourceTitle ? `本对话由「${sourceTitle}」分叉而来，点击跳回源对话` : "本对话由分叉而来，点击跳回源对话"}
        className="inline-flex max-w-[70%] items-center gap-1 rounded-full border border-dashed border-border/70 px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Icon name="gitFork" className="size-3 shrink-0" />
        <span className="truncate">从对话中派生{sourceTitle ? ` · ${sourceTitle}` : ""}</span>
      </button>
    </div>
  );
}
