import { Button } from "@/components/ui/button";
import { Icon } from "../ui/Icon";
import { Markdown, ThinkingCard } from "@pi-wood/ui-kit";
import { cn } from "@/lib/utils";
import { useSessionStore } from "../../stores/session-store";
import { useBtwStore } from "../../stores/btw-store";

/** T7.6 侧边问答面板：只读展示当前父会话对应的临时问答（不影响主会话流）。 */
export function BtwPanel(): React.JSX.Element {
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const transcript = useBtwStore((s) => s.bySession[currentSessionId || "__none__"]);
  const abort = useBtwStore((s) => s.abort);
  const dispose = useBtwStore((s) => s.dispose);

  const hasTranscript = Boolean(transcript);

  const adoptToMain = (): void => {
    if (!transcript?.text) return;
    window.dispatchEvent(
      new CustomEvent("piwood:composer-insert", { detail: { text: transcript.text.trim(), replace: false } }),
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3">
        <Icon name="message" className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {transcript ? transcript.question : "侧边问答"}
        </span>
        {transcript?.streaming && (
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-muted-foreground hover:text-foreground" onClick={() => void abort()}>
            <Icon name="stop" className="size-3.5" />
            停止
          </Button>
        )}
        {hasTranscript && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => void dispose()}
            aria-label="清除侧边问答并释放独立会话"
          >
            <Icon name="x" className="size-3.5" />
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2.5">
        {!hasTranscript && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
            <Icon name="message" className="size-6 opacity-50" />
            <p>在主会话输入 <code className="rounded bg-muted px-1 py-0.5 font-mono">/btw 你的问题</code></p>
            <p className="text-muted-foreground/70">侧边问答在独立会话里回答，不打断主任务，也不继续其计划。</p>
          </div>
        )}

        {transcript && (
          <div className="space-y-3">
            {transcript.thinking && <ThinkingCard text={transcript.thinking} streaming={transcript.streaming} defaultOpen={false} />}
            {transcript.error && (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                {transcript.error}
              </div>
            )}
            {transcript.text ? (
              <div className={cn("pk-prose max-w-none text-[13.5px]", transcript.streaming && "[&>*:last-child]:after:content-['▍'] [&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:text-primary")}>
                <Markdown>{transcript.text}</Markdown>
              </div>
            ) : (
              transcript.streaming && <p className="animate-pulse text-xs text-muted-foreground">侧边会话正在思考…</p>
            )}
            {transcript.aborted && !transcript.streaming && (
              <p className="text-xs text-warning">侧边回答已终止</p>
            )}
            {transcript.text && !transcript.streaming && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={adoptToMain}>
                <Icon name="arrowUp" className="size-3.5" />
                采用到主会话
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
