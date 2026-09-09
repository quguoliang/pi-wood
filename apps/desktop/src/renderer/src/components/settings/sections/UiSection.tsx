import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "../../../stores/settings-store";
import { SettingCard, SettingRow } from "../SettingRow";

/** 界面：工具卡/思考块/工具组的默认展开策略。直写 settings-store（乐观更新 + 落盘）。 */
export function UiSection(): React.JSX.Element {
  const ui = useSettingsStore((s) => s.settings.ui);
  const patchUi = useSettingsStore((s) => s.patch);
  const toggle = (key: keyof typeof ui) => (v: boolean): void => void patchUi({ ui: { ...ui, [key]: v } });

  return (
    <SettingCard>
      <SettingRow title="工具卡默认展开" description="新出现的工具调用卡片默认展开还是收起">
        <Switch checked={ui.toolCardsDefaultOpen} onCheckedChange={toggle("toolCardsDefaultOpen")} />
      </SettingRow>
      <SettingRow title="思考过程默认展开" description="模型的 thinking 块默认展开还是收起（流式时始终实时展开）">
        <Switch checked={ui.thinkingDefaultOpen} onCheckedChange={toggle("thinkingDefaultOpen")} />
      </SettingRow>
      <SettingRow title="连续工具分组" description="把连续多次工具调用折叠成一组（可用 Ctrl+Shift+E 展开/收起全部）；关闭则逐条显示">
        <Switch checked={ui.toolGroupsEnabled} onCheckedChange={toggle("toolGroupsEnabled")} />
      </SettingRow>
      <SettingRow title="工具组默认展开" description="新出现的工具组默认展开还是收起（运行中的组始终先展开）">
        <Switch checked={ui.toolGroupsDefaultOpen} onCheckedChange={toggle("toolGroupsDefaultOpen")} />
      </SettingRow>
    </SettingCard>
  );
}
