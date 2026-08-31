import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Streamdown as Markdown } from "streamdown";
import { useSessionStore } from "../../stores/session-store";

/**
 * T1.3 消息列表：@tanstack/react-virtual 虚拟滚动 + streamdown 流式 Markdown。
 * 流式 buffer 作为末尾一条临时行，跟随滚动到底。
 */
export function MessageList(): React.JSX.Element {
  const messages = useSessionStore((s) => s.messages);
  const streamBuffer = useSessionStore((s) => s.streamBuffer);
  const parentRef = useRef<HTMLDivElement>(null);

  const rows = messages.length > 0 || streamBuffer ? [...messages] : messages;
  const virtualizer = useVirtualizer({
    count: rows.length + (streamBuffer ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    getItemKey: (i) => (i < rows.length ? rows[i].id : "streaming"),
    overscan: 10,
  });

  // 跟随流式滚动到底
  const lastLen = rows.length + streamBuffer.length;
  useEffect(() => {
    virtualizer.scrollToIndex(virtualizer.options.count - 1, { align: "end" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastLen]);

  return (
    <div ref={parentRef} className="message-list">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const isStreaming = item.index >= rows.length;
          const m = rows[item.index];
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="message-row"
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}
            >
              {isStreaming ? (
                <div className="msg assistant">
                  <Markdown>{streamBuffer}</Markdown>
                </div>
              ) : m.kind === "user" ? (
                <div className="msg user">{m.text}</div>
              ) : m.kind === "assistant" ? (
                <div className="msg assistant">
                  <Markdown>{m.text}</Markdown>
                </div>
              ) : m.kind === "tool" ? (
                <div className={`tool-card tool-${m.status}`}>
                  <span className="tool-icon">
                    {m.status === "running" ? "…" : m.status === "ok" ? "done" : "fail"}
                  </span>
                  <b>{m.toolName}</b>
                  <span className="muted">{m.status}</span>
                </div>
              ) : (
                <div className="msg system">{m.text}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
