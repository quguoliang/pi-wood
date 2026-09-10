import { cn } from "@/lib/utils";
import { Icon } from "../ui/Icon";
import { useAssistStore } from "../../stores/assist-store";
import { useActiveConversation } from "../../stores/session-store";

/**
 * T7.9 会话辅助块：一轮结束后在**对话流末尾**（最后一条回复之后）淡显回顾 + 可点击的追问建议。
 *
 * 失效规则（三者任一即隐）：
 * - 手动关闭（✕）；
 * - 点掉任意一条建议（点击即隐，而不是常驻——建议已被采纳，继续挂着只会挤占对话流）；
 * - 关联失效：主会话 items 变长（下一轮已开始）或切换到别的会话。
 *
 * 宽度/对齐由调用方（MessageList 的对话流容器）负责，本组件只画内容，便于贴在最后一条消息后面。
 */
export function ConversationAssist({ className }: { className?: string }): React.JSX.Element | null {
  const recap = useAssistStore((s) => s.recap);
  const suggestions = useAssistStore((s) => s.suggestions);
  const session = useAssistStore((s) => s.session);
  const forItemsLen = useAssistStore((s) => s.forItemsLen);
  const dismissed = useAssistStore((s) => s.dismissed);
  const dismiss = useAssistStore((s) => s.dismiss);
  const currentSessionId = useActiveConversation((c) => c.currentSessionId) ?? "";
  const itemsLen = useActiveConversation((c) => c.items.length);

  // 关联失效：仅当仍属同一会话、且未出现更新的消息（items 长度未变）、且未手动关闭时展示
  const current = session === currentSessionId && itemsLen === forItemsLen;
  if (dismissed || !current || (!recap && suggestions.length === 0)) return null;

  const ask = (text: string): void => {
    window.dispatchEvent(new CustomEvent("piwood:composer-insert", { detail: { text, replace: false } }));
    // 建议已落到输入框：本块功成身退，不再常驻
    dismiss();
  };

  return (
    <div className={cn("w-full", className)}>
      {/* 回顾：限高 2 行（短内容自然只占 1 行，长内容截断，完整文本挂在 title 上），
          避免一段小字灰文把整块撑高 */}
      {recap && (
        <div className="mb-1.5 flex items-start gap-2">
          <Icon name="sparkles" className="mt-[3px] size-3.5 shrink-0 text-muted-foreground/60" />
          <p title={recap} className="line-clamp-2 min-w-0 flex-1 text-[12px] leading-[1.5] text-muted-foreground">
            {recap}
          </p>
          <button
            type="button"
            onClick={dismiss}
            aria-label="忽略本次建议"
            className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
          >
            <Icon name="x" className="size-3.5" />
          </button>
        </div>
      )}
      {/* 建议：竖排 + 左对齐，胶囊宽度随内容伸缩（不铺满、不横排挤成一行） */}
      {suggestions.length > 0 && (
        <div className="flex flex-col items-start gap-1.5">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => ask(s)}
              title={s}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-card/40 px-2.5 py-1 text-left text-[12.5px] text-foreground/85 transition-[transform,background-color,border-color,color] motion-safe:hover:border-primary/45 motion-safe:hover:bg-accent/40 motion-safe:hover:text-foreground motion-safe:active:scale-[0.98]"
            >
              <span className="min-w-0 truncate">{s}</span>
              <Icon name="arrowRight" className="size-3 shrink-0 text-muted-foreground/70" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
