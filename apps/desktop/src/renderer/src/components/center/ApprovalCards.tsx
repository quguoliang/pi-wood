import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** T4.1 审批卡片：工具调用前经 IPC 往返请求用户决策；超时主进程默认拒绝 */
interface PendingApproval {
  id: number;
  title: string;
  message: string;
}

export function ApprovalCards(): React.JSX.Element {
  const [pending, setPending] = useState<PendingApproval[]>([]);

  useEffect(() => {
    const off = window.pi.onApprovalRequest((d) => setPending((p) => [...p, d]));
    return off;
  }, []);

  const decide = (id: number, allow: boolean): void => {
    void window.pi.approvalDecide(id, allow);
    setPending((p) => p.filter((x) => x.id !== id));
  };

  if (pending.length === 0) return <></>;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex w-[420px] max-w-[calc(100vw-3rem)] flex-col gap-3">
      {pending.map((a) => (
        <div key={a.id} className="rounded-xl border border-border bg-card p-4 shadow-lg">
          <div className="text-sm font-medium text-foreground">{a.title}</div>
          <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2.5 text-xs leading-relaxed whitespace-pre-wrap break-all text-muted-foreground">{a.message}</pre>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="destructive" onClick={() => decide(a.id, false)}>拒绝</Button>
            <Button size="sm" onClick={() => decide(a.id, true)}>允许</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
