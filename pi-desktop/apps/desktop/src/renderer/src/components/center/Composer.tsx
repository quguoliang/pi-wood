import { useState } from "react";
import { useSessionStore } from "../../stores/session-store";

/** T1.3 输入区：Enter=发送(prompt)，Alt+Enter=followUp 排队，流式中显示"中止" */
export function Composer(): React.JSX.Element {
  const [input, setInput] = useState("");
  const streaming = useSessionStore((s) => s.streaming);
  const engineReady = useSessionStore((s) => s.engineReady);

  const send = (mode: "prompt" | "followUp"): void => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    // user 消息由主进程 user_message 事件回显，避免双份
    if (mode === "prompt") void window.pi.prompt(text);
    else void window.pi.engineFollowUp(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      send("prompt");
    } else if (e.key === "Enter" && e.altKey) {
      e.preventDefault();
      send("followUp");
    }
  };

  return (
    <div className="composer-wrap">
      {!engineReady && <div className="muted pick-hint">先在左栏选择项目以启动引擎</div>}
      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="输入 prompt（Enter 发送 · Alt+Enter followUp 排队 · Shift+Enter 换行）"
          rows={3}
          disabled={!engineReady}
        />
        {streaming ? (
          <button className="abort" onClick={() => void window.pi.engineAbort()}>中止</button>
        ) : (
          <button onClick={() => send("prompt")} disabled={!engineReady || !input.trim()}>发送</button>
        )}
      </div>
    </div>
  );
}
