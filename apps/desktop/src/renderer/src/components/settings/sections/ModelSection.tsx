import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveConversation } from "../../../stores/session-store";
import { SettingCard, SettingGroupLabel, SettingRow } from "../SettingRow";

/**
 * 默认模型 + 辅助/审计小模型（T7.5/T7.9）。
 * 模型列表依赖引擎就绪（engineReady 守卫保留）；小模型选择即存（传 null=沿用默认）。
 */
type ModelRef = { provider: string; id: string };

export function ModelSection(): React.JSX.Element {
  const engineReady = useActiveConversation((c) => c.engineReady);
  const [models, setModels] = useState<Array<{ provider: string; id: string }>>([]);
  const [model, setModel] = useState<ModelRef>({ provider: "", id: "" });
  const [smallModel, setSmallModel] = useState<ModelRef | null>(null);

  useEffect(() => {
    void window.pi.settingsGet().then((s) => {
      const st = s as { model?: ModelRef; smallModel?: ModelRef | null };
      if (st.model) setModel(st.model);
      if (st.smallModel && st.smallModel.provider) setSmallModel(st.smallModel);
    });
  }, []);

  useEffect(() => {
    if (engineReady) void window.pi.engineModels().then(setModels).catch(() => setModels([]));
    else setModels([]);
  }, [engineReady]);

  const saveDefaultModel = (): void => {
    void window.pi.settingsSet({ model }).then(() => toast.success("默认模型已保存"));
  };

  const saveSmallModel = (m: ModelRef | null): void => {
    const next = m ?? { provider: "", id: "" };
    setSmallModel(m);
    void window.pi.settingsSet({ smallModel: next }).then(() => toast.success(m ? "辅助/审计小模型已保存" : "已恢复：沿用默认模型"));
  };

  return (
    <div className="space-y-6">
      <div>
        <SettingGroupLabel>默认模型</SettingGroupLabel>
        <p className="mb-2 text-xs text-muted-foreground">可用模型（需先在左栏选择项目以启动引擎）</p>
        <SettingCard>
          <SettingRow title="主对话模型" description="新会话默认使用的模型">
            <Select
              value={String(models.findIndex((m) => m.provider === model.provider && m.id === model.id))}
              onValueChange={(v) => {
                const m = models[Number(v)];
                if (m) setModel(m);
              }}
              disabled={models.length === 0}
            >
              <SelectTrigger className="w-64" size="sm">
                <SelectValue placeholder={models.length === 0 ? "（未获取到模型列表）" : "选择默认模型"} />
              </SelectTrigger>
              <SelectContent>
                {models.map((m, i) => (
                  <SelectItem key={`${m.provider}/${m.id}`} value={String(i)}>
                    {m.provider} / {m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={saveDefaultModel} disabled={models.length === 0}>
              设为默认
            </Button>
          </SettingRow>
        </SettingCard>
      </div>

      <div>
        <SettingGroupLabel>辅助 / 审计小模型</SettingGroupLabel>
        <p className="mb-2 text-xs text-muted-foreground">
          用于目标模式的进度审计与会话 recap/追问，让主对话用强模型、辅助任务用更省的模型。留「沿用默认」则不设独立小模型。
        </p>
        <SettingCard>
          <SettingRow title="辅助小模型" description="目标审计 / recap / 追问使用">
            <Select
              value={smallModel?.provider ? String(models.findIndex((m) => m.provider === smallModel.provider && m.id === smallModel.id)) : "-1"}
              onValueChange={(v) => {
                if (v === "-1") saveSmallModel(null);
                else {
                  const m = models[Number(v)];
                  if (m) saveSmallModel(m);
                }
              }}
              disabled={models.length === 0}
            >
              <SelectTrigger className="w-64" size="sm">
                <SelectValue placeholder="选择辅助/审计小模型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="-1">（沿用默认模型）</SelectItem>
                {models.map((m, i) => (
                  <SelectItem key={`small-${m.provider}/${m.id}`} value={String(i)}>
                    {m.provider} / {m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        </SettingCard>
      </div>
    </div>
  );
}
