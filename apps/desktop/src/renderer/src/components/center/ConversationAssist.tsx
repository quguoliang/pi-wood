import { cn } from "@/lib/utils";
import { Icon } from "../ui/Icon";
import { useAssistStore } from "../../stores/assist-store";
import { useSessionStore } from "../../stores/session-store";

/** T7.9 会话辅助条：一轮结束后在主会话上方淡显回顾 + 可点击的追问建议；新消息/切会话/手动关闭即隐。 */
export function ConversationAssist({ className }: { className?: string }): React.JSX.Element | null {
  const recap = useAssistStore((s) => s.recap);
  const suggestions = useAssistStore((s) => s.suggestions);
  const session = useAssistStore((s) => s.session);
  const forItemsLen = useAssistStore((s) => s.forItemsLen);
  const dismissed = useAssistStore((s) => s.dismissed);
  const dismiss = useAssistStore((s) => s.dismiss);
  const currentSessionId = useSessionStore((s) => s.currentSessionId) ?? "";
  const itemsLen = useSessionStore((s) => s.items.length);

  // 关联失效：仅当仍属同一会话、且未出现更新的消息（items 长度未变）、且未手动关闭时展示
  const current = session === currentSessionId && itemsLen === forItemsLen;
  if (dismissed || !current || (!recap && suggestions.length === 0)) return null;

  const ask = (text: string): void => {
    window.dispatchEvent(new CustomEvent("piwood:composer-insert", { detail: { text, replace: false } }));
  };

  return (
    <div className={cn("mx-auto w-full max-w-[var(--pk-chat-width,48rem)] px-4", className)}>
      <div className="flex items-start gap-2 rounded-lg border border-border/50 bg-white/[0.02] px-3 py-2">
        <Icon name="brain" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          {recap && <p className="text-xs leading-relaxed text-muted-foreground">{recap}</p>}
          {suggestions.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => ask(s)}
                  className="max-w-full truncate rounded-full border border-border/60 bg-muted/40 px-2.5 py-0.5 text-[11px] text-muted-foreground transition-[transform,background-color,color,border-color] motion-safe:hover:border-primary/50 motion-safe:hover:text-foreground motion-safe:active:scale-[0.97]"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="忽略本次建议"
          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Icon name="x" className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
