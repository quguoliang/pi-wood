import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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

  const cancel = (): void => respond(request?.kind === "confirm" ? false : undefined);

  if (!request) return <></>;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) cancel(); }}>
      <DialogContent className="max-w-md gap-4" {...(request.message ? {} : { "aria-describedby": undefined })}>
        <DialogHeader>
          <DialogTitle>{request.title}</DialogTitle>
          {request.message && (
            <DialogDescription>{request.message}</DialogDescription>
          )}
        </DialogHeader>

        {request.kind === "select" && (
          <div className="flex flex-col gap-2">
            {(request.options ?? []).map((option) => (
              <Button key={option} type="button" variant="outline" className="justify-start" onClick={() => respond(option)}>
                {option}
              </Button>
            ))}
          </div>
        )}
        {request.kind === "input" && (
          <Input
            autoFocus
            value={draft}
            placeholder={request.placeholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && draft && respond(draft)}
          />
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={cancel}>取消</Button>
          {request.kind === "confirm" && <Button type="button" onClick={() => respond(true)}>确认</Button>}
          {request.kind === "input" && <Button type="button" disabled={!draft} onClick={() => respond(draft)}>提交</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
