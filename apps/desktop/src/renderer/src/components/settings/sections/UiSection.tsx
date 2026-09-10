import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "../../../stores/settings-store";
import { SettingCard, SettingRow } from "../SettingRow";

/** 界面：工具卡/思考块/工具组的默认展开策略。直写 settings-store（乐观更新 + 落盘）。 */
export function UiSection(): React.JSX.Element {
  const ui = useSettingsStore((s) => s.settings.ui);
  const patchUi = useSettingsStore((s) => s.patch);
  const toggle = (key: keyof typeof ui) => (v: boolean): void => void patchUi({ ui: { ...ui, [key]: v } });

  /**
   * 总开关「对话信息默认展开」：不新增持久化字段，而是把下面三项明细一次性写成同一值
   * （单一事实来源，避免总开关与明细各存一份后互相打架）。
   * 打开 = 工具调用 / 文件查看 / 思考过程 / 工具组默认全部展开；关闭 = 全部收起。
   * 状态回读为「三项全开」，用户手动关掉任一项后总开关自然显示为关。
   */
  const detailsAllOpen = ui.toolCardsDefaultOpen && ui.thinkingDefaultOpen && ui.toolGroupsDefaultOpen;
  const setDetailsAllOpen = (v: boolean): void =>
    void patchUi({ ui: { ...ui, toolCardsDefaultOpen: v, thinkingDefaultOpen: v, toolGroupsDefaultOpen: v } });

  return (
    <SettingCard>
      <SettingRow
        title="对话信息默认展开"
        description="打开后，工具调用 / 文件查看 / 思考过程 / 工具组在对话流里默认全部展开；关闭则默认全部收起（等价于下方三项一起开关）"
      >
        <Switch checked={detailsAllOpen} onCheckedChange={setDetailsAllOpen} />
      </SettingRow>
      <SettingRow title="工具卡默认展开" description="新出现的工具调用卡片默认展开还是收起（含读取文件的输出）">
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
