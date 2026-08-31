import { Check, Copy, RotateCcw } from "lucide-react";
import { useState } from "react";
import {
  Button,
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
  Loader,
  Message,
  MessageAction,
  MessageActions,
  MessageAvatar,
  MessageContent,
  Tool,
  type ToolPart,
} from "@pi-wood/ui-kit";
import { useSessionStore, type UIMessage } from "../../stores/session-store";

/**
 * 消息列表（prompt-kit 官方 demo 结构对齐版）：
 * - ChatContainer（use-stick-to-bottom）：流式期间智能跟随底部，上翻阅读不打断。
 * - Message 横向 flex 行：user 右对齐气泡，assistant 头像 + 全宽 Markdown 正文
 *   + hover 显示的 MessageActions（复制/重试）。
 * - Markdown 为 prompt-kit 官方组件（react-markdown + remark-gfm + marked 分块
 *   memo + shiki CodeBlock），排版规则见 styles.css `.pk-prose`。
 */

function toolPartOf(m: Extract<UIMessage, { kind: "tool" }>): ToolPart {
  const isError = m.status === "error";
  return {
    type: m.toolName,
    state: m.status === "running" ? "input-streaming" : isError ? "output-error" : "output-available",
    input: m.input,
    output: m.output !== undefined && !isError ? { result: m.output } : undefined,
    toolCallId: m.toolCallId,
    errorText: isError ? m.output : undefined,
  };
}

function CopyAction({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <MessageAction tooltip="复制">
      <Button
        variant="ghost"
        size="icon"
        aria-label="复制消息"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check className="icon" /> : <Copy className="icon" />}
      </Button>
    </MessageAction>
  );
}

function UserMessage({ m }: { m: Extract<UIMessage, { kind: "user" }> }): React.JSX.Element {
  return (
    <Message className="pk-message-user">
      <MessageContent>{m.text}</MessageContent>
    </Message>
  );
}

function AssistantMessage({
  m,
  isLast,
}: {
  m: Extract<UIMessage, { kind: "assistant" }>;
  isLast: boolean;
}): React.JSX.Element {
  const [retrying, setRetrying] = useState(false);

  // 重试：找到该 assistant 消息之前最近一条 user 消息，以 followUp 重新发送
  const retry = async (): Promise<void> => {
    const { messages } = useSessionStore.getState();
    const index = messages.findIndex((item) => item.id === m.id);
    const lastUser = [...messages.slice(0, index)].reverse().find((item) => item.kind === "user");
    if (!lastUser || lastUser.kind !== "user") return;
    setRetrying(true);
    try {
      await window.pi.engineFollowUp(lastUser.text);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Message className="pk-message-assistant">
      <MessageAvatar alt="Pi" fallback="π" />
      <div className="pk-message-main">
        <MessageContent markdown className="pk-prose">
          {m.text}
        </MessageContent>
        <MessageActions>
          <CopyAction text={m.text} />
          {isLast && (
            <MessageAction tooltip="重试">
              <Button
                variant="ghost"
                size="icon"
                aria-label="重试"
                disabled={retrying}
                onClick={() => void retry()}
              >
                <RotateCcw className="icon" />
              </Button>
            </MessageAction>
          )}
        </MessageActions>
      </div>
    </Message>
  );
}

function MessageRow({
  m,
  isLast,
}: {
  m: UIMessage;
  isLast: boolean;
}): React.JSX.Element {
  if (m.kind === "user") return <UserMessage m={m} />;
  if (m.kind === "assistant") return <AssistantMessage m={m} isLast={isLast} />;
  if (m.kind === "tool") {
    return (
      <Message className="pk-message-tool">
        <Tool toolPart={toolPartOf(m)} />
      </Message>
    );
  }
  return (
    <Message className="pk-message-system">
      <MessageContent>{m.text}</MessageContent>
    </Message>
  );
}

export function MessageList(): React.JSX.Element {
  const messages = useSessionStore((s) => s.messages);
  const streamBuffer = useSessionStore((s) => s.streamBuffer);
  const streaming = useSessionStore((s) => s.streaming);
  const lastId = messages.length > 0 ? messages[messages.length - 1].id : undefined;

  return (
    <ChatContainerRoot className="message-list" aria-live="polite">
      {messages.length === 0 && !streamBuffer && (
        <section className="conversation-empty">
          <h1>今天想从哪里开始？</h1>
          <p>描述目标、添加相关文件，pi-wood 会在当前项目中完成任务。</p>
        </section>
      )}
      <ChatContainerContent>
        {messages.map((m) => (
          <MessageRow key={m.id} m={m} isLast={m.id === lastId} />
        ))}
        {streamBuffer ? (
          <Message className="pk-message-assistant pk-message-streaming">
            <MessageAvatar alt="Pi" fallback="π" />
            <div className="pk-message-main">
              <MessageContent markdown className="pk-prose">
                {streamBuffer}
              </MessageContent>
            </div>
          </Message>
        ) : (
          streaming && (
            <div className="pk-message-loading">
              <Loader variant="typing" size="sm" />
            </div>
          )
        )}
        <ChatContainerScrollAnchor />
      </ChatContainerContent>
    </ChatContainerRoot>
  );
}
