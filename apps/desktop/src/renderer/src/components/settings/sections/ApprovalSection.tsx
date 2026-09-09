import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingCard, SettingRow } from "../SettingRow";

/**
 * 审批策略（§9 四档）：敏感文件（.env/.git/.ssh 等）始终拦截，与此档正交。
 * 选择即存（settingsSet approval.mode），与旧 modal 行为一致。
 */
const approvalOptions: Array<[string, string, string]> = [
  ["auto", "全自动（不询问）", "所有工具调用直接执行，适合完全信任的沙箱环境"],
  ["highRisk", "高风险审批", "bash / edit / write 需确认，其余自动放行"],
  ["allAsk", "全部审批", "每一次工具调用都需人工确认"],
  ["denyAll", "全部拒绝", "拒绝所有工具调用，仅纯对话"],
];

export function ApprovalSection(): React.JSX.Element {
  const [approvalMode, setApprovalMode] = useState<string>("highRisk");

  useEffect(() => {
    void window.pi.settingsGet().then((s) => {
      const st = s as { approval?: { mode?: string } };
      if (st.approval?.mode) setApprovalMode(st.approval.mode);
    });
  }, []);

  const saveApproval = (mode: string): void => {
    setApprovalMode(mode);
    void window.pi.settingsSet({ approval: { mode, rules: [] } }).then(() => toast.success("审批策略已保存"));
  };

  return (
    <SettingCard>
      {approvalOptions.map(([mode, label, desc]) => (
        <SettingRow key={mode} title={label} description={desc}>
          {approvalMode === mode ? (
            <span className="text-xs font-medium text-primary">当前</span>
          ) : (
            <button
              type="button"
              className="rounded-md border border-border/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => saveApproval(mode)}
            >
              选用
            </button>
          )}
        </SettingRow>
      ))}
    </SettingCard>
  );
}
