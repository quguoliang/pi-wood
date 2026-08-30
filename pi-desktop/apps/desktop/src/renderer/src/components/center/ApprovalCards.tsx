import { useEffect, useState } from "react";

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
    <div className="approval-stack">
      {pending.map((a) => (
        <div key={a.id} className="approval-card">
          <div className="approval-title">🔐 {a.title}</div>
          <pre className="approval-body">{a.message}</pre>
          <div className="approval-actions">
            <button className="deny" onClick={() => decide(a.id, false)}>拒绝</button>
            <button className="allow" onClick={() => decide(a.id, true)}>允许</button>
          </div>
        </div>
      ))}
    </div>
  );
}
