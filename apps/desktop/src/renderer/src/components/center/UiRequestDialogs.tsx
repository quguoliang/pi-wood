import { useEffect, useState } from "react";

interface UiRequest {
  id: number;
  kind: "select" | "confirm" | "input";
  title: string;
  options?: string[];
  message?: string;
  placeholder?: string;
}

export function UiRequestDialogs(): React.JSX.Element {
  const [queue, setQueue] = useState<UiRequest[]>([]);
  const [draft, setDraft] = useState("");
  const request = queue[0];

  useEffect(() => window.pi.onUiRequest((next) => setQueue((items) => [...items, next])), []);
  useEffect(() => setDraft(""), [request?.id]);

  const respond = (value?: string | boolean): void => {
    if (!request) return;
    void window.pi.uiRespond(request.id, value);
    setQueue((items) => items.slice(1));
  };

  if (!request) return <></>;

  return (
    <div className="modal-mask ui-request-mask">
      <section className="ui-request-dialog" role="dialog" aria-modal="true" aria-labelledby="ui-request-title">
        <h2 id="ui-request-title">{request.title}</h2>
        {request.message && <p>{request.message}</p>}
        {request.kind === "select" && (
          <div className="ui-request-options">
            {(request.options ?? []).map((option) => (
              <button key={option} type="button" onClick={() => respond(option)}>{option}</button>
            ))}
          </div>
        )}
        {request.kind === "input" && (
          <input
            autoFocus
            value={draft}
            placeholder={request.placeholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && draft && respond(draft)}
          />
        )}
        <div className="approval-actions">
          <button className="deny" type="button" onClick={() => respond(request.kind === "confirm" ? false : undefined)}>取消</button>
          {request.kind === "confirm" && <button className="allow" type="button" onClick={() => respond(true)}>确认</button>}
          {request.kind === "input" && <button className="allow" type="button" disabled={!draft} onClick={() => respond(draft)}>提交</button>}
        </div>
      </section>
    </div>
  );
}
