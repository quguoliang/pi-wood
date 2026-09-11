import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "../../../stores/settings-store";
import { SettingCard, SettingRow } from "../SettingRow";

/** 界面：工具卡/思考块/工具组的默认展开策略。直写 settings-store（乐观更新 + 落盘）。 */
export function UiSection(): React.JSX.Element {
  const ui = useSettingsStore((s) => s.settings.ui);
  const patchUi = useSettingsStore((s) => s.patch);
  const toggle = (key: keyof typeof ui) => (v: boolean): void => void patchUi({ ui: { ...ui, [key]: v } });

  /**
   * T11.1 生成式 UI：开关只改设置是**不够的**——内置指令是在引擎侧每次资源加载时读设置拼进
   * 系统提示词，已启动的对话必须走一次引擎 reload 才会重建提示词。
   * reload 对当前对话即时生效，不必重启应用；失败不阻断开关本身（下次启动仍会读到新值）。
   */
  const setGenerativeUi = (v: boolean): void => {
    void patchUi({ ui: { ...ui, generativeUi: v } });
    void window.pi.engineReload().catch(() => undefined);
  };

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
      <SettingRow title="思考过程默认展开" description="模型的 thinking 块默认展开还是收起；流式进行中同样遵循该设置，收起时头部仍显示「思考中…」与实时尾部预览">
        <Switch checked={ui.thinkingDefaultOpen} onCheckedChange={toggle("thinkingDefaultOpen")} />
      </SettingRow>
      <SettingRow title="连续工具分组" description="把连续多次工具调用折叠成一组（可用 Ctrl+Shift+E 展开/收起全部）；关闭则逐条显示">
        <Switch checked={ui.toolGroupsEnabled} onCheckedChange={toggle("toolGroupsEnabled")} />
      </SettingRow>
      <SettingRow title="工具组默认展开" description="新出现的工具组默认展开还是收起；运行中的组同样遵循该设置，收起时头部仍显示数量与运行进度">
        <Switch checked={ui.toolGroupsDefaultOpen} onCheckedChange={toggle("toolGroupsDefaultOpen")} />
      </SettingRow>
      <SettingRow
        title="生成式 UI"
        description="开启后，模型可在回复正文中输出可视化 UI（对比卡 / 步骤条 / 可点选项），本应用在沙箱 iframe 内渲染。指令随系统提示词下发，切换后对当前对话即时生效；默认关闭。"
      >
        <Switch checked={ui.generativeUi} onCheckedChange={setGenerativeUi} />
      </SettingRow>
    </SettingCard>
  );
}
