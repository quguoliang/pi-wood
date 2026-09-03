import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "../../stores/settings-store";
import { cn } from "@/lib/utils";
import { useSessionStore } from "../../stores/session-store";
import { PluginsPanel } from "./PluginsPanel";
import { SubagentPermissionsPanel } from "./SubagentPermissionsPanel";
import { MemorySettingsPanel } from "./MemorySettingsPanel";

/**
 * T3.2/T3.3 设置弹窗：Providers 密钥（safeStorage 钥匙串）/ 模型默认 / 审批策略 / 主题。
 * shadcn Dialog 外壳 + 左栏自绘导航，数据加载与保存逻辑不变。
 */
interface ProviderInfo {
  id: string;
  name: string;
  hasKey: boolean;
}

const sections = [
  { id: "providers", label: "模型源" },
  { id: "model", label: "默认模型" },
  { id: "approval", label: "审批策略" },
  { id: "theme", label: "主题" },
  { id: "ui", label: "界面" },
  { id: "ext", label: "扩展与包" },
  { id: "plugins", label: "插件" },
  { id: "subagent", label: "子代理" },
  { id: "memory", label: "记忆" },
] as const;

const approvalOptions: Array<[string, string]> = [
  ["auto", "全自动（不询问）"],
  ["highRisk", "高风险审批（bash/edit/write 需确认）"],
  ["allAsk", "全部审批"],
  ["denyAll", "全部拒绝"],
];

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{children}</h3>
      {action}
    </div>
  );
}

function ListRow({ primary, secondary }: { primary: React.ReactNode; secondary?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent">
      <span className="min-w-0 truncate">{primary}</span>
      {secondary ? <span className="shrink-0 text-xs text-muted-foreground">{secondary}</span> : null}
    </div>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<"providers" | "model" | "approval" | "theme" | "ui" | "ext" | "plugins" | "subagent" | "memory">("providers");
  const ui = useSettingsStore((s) => s.settings.ui);
  const patchUi = useSettingsStore((s) => s.patch);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  const [models, setModels] = useState<Array<{ provider: string; id: string }>>([]);
  const [model, setModel] = useState<{ provider: string; id: string }>({ provider: "", id: "" });
  const [smallModel, setSmallModel] = useState<{ provider: string; id: string }>({ provider: "", id: "" });
  const [approvalMode, setApprovalMode] = useState<string>("highRisk");
  const [theme, setTheme] = useState<string>("dark");
  const [saved, setSaved] = useState("");
  const [extensions, setExtensions] = useState<Array<{ source: string; name: string; path: string }>>([]);
  const [resources, setResources] = useState<Array<{ kind: "skill" | "prompt"; source: string; name: string; path: string }>>([]);
  const [packages, setPackages] = useState<string[]>([]);
  const [pkgSpec, setPkgSpec] = useState("");
  const [pkgOutput, setPkgOutput] = useState("");

  const flash = (msg: string): void => {
    setSaved(msg);
    setTimeout(() => setSaved(""), 2000);
  };

  useEffect(() => {
    void window.pi.providerList().then((r) => {
      const list = (r as { builtin: ProviderInfo[] }).builtin ?? [];
      setProviders(list);
    });
    void window.pi.extensionsList().then((r) => setExtensions(r as typeof extensions));
    void window.pi.resourcesList().then((r) => setResources(r as typeof resources));
    void window.pi.packagesList().then((r) => setPackages(r.packages));
    void window.pi.settingsGet().then((s) => {
      const st = s as { model?: { provider: string; id: string }; smallModel?: { provider: string; id: string } | null; approval?: { mode: string }; theme?: { fallback: string } };
      if (st.model) setModel(st.model);
      if (st.smallModel && st.smallModel.provider) setSmallModel(st.smallModel);
      if (st.approval?.mode) setApprovalMode(st.approval.mode);
      if (st.theme?.fallback) setTheme(st.theme.fallback);
    });
  }, []);

  const engineReady = useSessionStore((s) => s.engineReady);
  useEffect(() => {
    // 默认模型列表依赖引擎；未就绪时不拉取（§8 状态不变量）
    if (engineReady) void window.pi.engineModels().then(setModels).catch(() => setModels([]));
    else setModels([]);
  }, [engineReady]);

  const installPackage = (): void => {
    const spec = pkgSpec.trim();
    if (!spec) return;
    setPkgOutput("安装中（经 pi CLI，最长 2 分钟）…");
    void window.pi
      .packagesInstall(spec)
      .then((r) => {
        setPkgOutput(r.output || "完成");
        setPkgSpec("");
        void window.pi.packagesList().then((r2) => setPackages(r2.packages));
      })
      .catch((err) => setPkgOutput(String((err as Error)?.message ?? err)));
  };

  const saveKey = (provider: string): void => {
    const key = keyDraft[provider];
    if (!key) return;
    void window.pi.providerSetKey(provider, key).then(() => {
      setKeyDraft((d) => ({ ...d, [provider]: "" }));
      setProviders((ps) => ps.map((p) => (p.id === provider ? { ...p, hasKey: true } : p)));
      flash("密钥已存入钥匙串（下次选择项目生效）");
    });
  };

  const saveDefaultModel = (): void => {
    void window.pi.settingsSet({ model }).then(() => flash("默认模型已保存"));
  };

  // T7.5/T7.9：辅助/审计小模型；传 null=沿用默认模型（存空哨兵 {provider:"",id:""}，选模型时视为无效跳过）
  const saveSmallModel = (m: { provider: string; id: string } | null): void => {
    const next = m ?? { provider: "", id: "" };
    setSmallModel(next);
    void window.pi.settingsSet({ smallModel: next }).then(() => flash(m ? "辅助/审计小模型已保存" : "已恢复：沿用默认模型"));
  };

  const saveApproval = (mode: string): void => {
    setApprovalMode(mode);
    void window.pi.settingsSet({ approval: { mode, rules: [] } }).then(() => flash("审批策略已保存"));
  };

  const saveTheme = (fallback: string): void => {
    setTheme(fallback);
    void window.pi.settingsSet({ theme: { fallback: fallback as "light" | "dark" | "system" } });
    document.documentElement.dataset.theme = fallback;
    flash("主题已保存");
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0" aria-describedby={undefined}>
        <div className="flex h-[560px] max-h-[calc(100vh-4rem)]">
          <aside className="flex w-44 shrink-0 flex-col gap-1 border-r border-border bg-muted/40 p-3">
            <DialogTitle className="px-2 pb-2 text-sm font-semibold">设置</DialogTitle>
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setTab(s.id)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                  tab === s.id ? "bg-accent font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
            <span className="mt-auto px-2 pt-2 text-xs text-muted-foreground">{saved}</span>
          </aside>

          <div className="min-w-0 flex-1 overflow-y-auto p-6">
            {tab === "providers" && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">密钥经系统钥匙串（DPAPI）加密存储于 ~/.pi-wood/keys.json</p>
                {providers.map((p) => (
                  <div key={p.id} className="flex items-center gap-3">
                    <span className="w-36 shrink-0 truncate text-sm">
                      {p.name} · {p.hasKey ? "已配置" : "未配置"}
                    </span>
                    <Input
                      type="password"
                      className="min-w-0 flex-1"
                      placeholder={p.hasKey ? "已配置（输入可覆盖）" : `${p.id.toUpperCase()}_API_KEY`}
                      value={keyDraft[p.id] ?? ""}
                      onChange={(e) => setKeyDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                    />
                    <Button size="sm" variant="secondary" disabled={!keyDraft[p.id]} onClick={() => saveKey(p.id)}>保存</Button>
                  </div>
                ))}
              </div>
            )}

            {tab === "model" && (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">可用模型（需先在左栏选择项目以启动引擎）</p>
                {models.length === 0 && <p className="text-xs text-muted-foreground">(未获取到模型列表)</p>}
                <Select
                  value={String(models.findIndex((m) => m.provider === model.provider && m.id === model.id))}
                  onValueChange={(v) => {
                    const m = models[Number(v)];
                    if (m) setModel(m);
                  }}
                  disabled={models.length === 0}
                >
                  <SelectTrigger className="w-full" size="sm">
                    <SelectValue placeholder="选择默认模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m, i) => (
                      <SelectItem key={`${m.provider}/${m.id}`} value={String(i)}>
                        {m.provider} / {m.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div>
                  <Button size="sm" onClick={saveDefaultModel} disabled={models.length === 0}>设为默认</Button>
                </div>

                <div className="space-y-1.5 pt-1">
                  <p className="text-xs text-muted-foreground">
                    辅助 / 审计小模型（可选）：用于目标模式的进度审计与会话 recap/追问，让主对话用强模型、辅助任务用更省的模型。留「沿用默认」则不设独立小模型。
                  </p>
                  <Select
                    value={smallModel.provider ? String(models.findIndex((m) => m.provider === smallModel.provider && m.id === smallModel.id)) : "-1"}
                    onValueChange={(v) => {
                      if (v === "-1") saveSmallModel(null);
                      else { const m = models[Number(v)]; if (m) saveSmallModel(m); }
                    }}
                    disabled={models.length === 0}
                  >
                    <SelectTrigger className="w-full" size="sm">
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
                </div>
              </div>
            )}

            {tab === "approval" && (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">四档策略（§9）：敏感文件（.env/.git/.ssh 等）始终拦截</p>
                <Select value={approvalMode} onValueChange={saveApproval}>
                  <SelectTrigger className="w-full" size="sm">
                    <SelectValue placeholder="选择审批策略" />
                  </SelectTrigger>
                  <SelectContent>
                    {approvalOptions.map(([mode, label]) => (
                      <SelectItem key={mode} value={mode}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {tab === "theme" && (
              <div className="space-y-4">
                <Select value={theme} onValueChange={saveTheme}>
                  <SelectTrigger className="w-48" size="sm">
                    <SelectValue placeholder="选择主题" />
                  </SelectTrigger>
                  <SelectContent>
                    {["dark", "light", "system"].map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {tab === "ui" && (
              <div className="space-y-1">
                <label className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm hover:bg-accent">
                  <span className="min-w-0">
                    <span className="block font-medium">工具卡默认展开</span>
                    <span className="block text-xs text-muted-foreground">新出现的工具调用卡片默认展开还是收起</span>
                  </span>
                  <Switch checked={ui.toolCardsDefaultOpen} onCheckedChange={(v) => void patchUi({ ui: { ...ui, toolCardsDefaultOpen: v } })} />
                </label>
                <label className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm hover:bg-accent">
                  <span className="min-w-0">
                    <span className="block font-medium">思考过程默认展开</span>
                    <span className="block text-xs text-muted-foreground">模型的 thinking 块默认展开还是收起（流式时始终实时展开）</span>
                  </span>
                  <Switch checked={ui.thinkingDefaultOpen} onCheckedChange={(v) => void patchUi({ ui: { ...ui, thinkingDefaultOpen: v } })} />
                </label>
                <label className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm hover:bg-accent">
                  <span className="min-w-0">
                    <span className="block font-medium">连续工具分组</span>
                    <span className="block text-xs text-muted-foreground">把连续多次工具调用折叠成一组（可用 Ctrl+Shift+E 展开/收起全部）；关闭则逐条显示</span>
                  </span>
                  <Switch checked={ui.toolGroupsEnabled} onCheckedChange={(v) => void patchUi({ ui: { ...ui, toolGroupsEnabled: v } })} />
                </label>
                <label className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm hover:bg-accent">
                  <span className="min-w-0">
                    <span className="block font-medium">工具组默认展开</span>
                    <span className="block text-xs text-muted-foreground">新出现的工具组默认展开还是收起（运行中的组始终先展开）</span>
                  </span>
                  <Switch checked={ui.toolGroupsDefaultOpen} onCheckedChange={(v) => void patchUi({ ui: { ...ui, toolGroupsDefaultOpen: v } })} />
                </label>
              </div>
            )}

            {tab === "ext" && (
              <div className="space-y-6">
                <section>
                  <SectionTitle action={
                    <Button size="sm" variant="outline" onClick={() => void window.pi.engineReload().then(() => flash("已重载扩展"))}>
                      重载扩展
                    </Button>
                  }>
                    已加载扩展（选中项目后点“重载”生效）
                  </SectionTitle>
                  {extensions.length === 0 && <p className="text-xs text-muted-foreground">未发现扩展（全局 ~/.pi/agent/extensions 或项目 .pi/extensions）</p>}
                  <div className="space-y-0.5">
                    {extensions.map((x) => (
                      <ListRow key={x.path} primary={x.name} secondary={x.source === "global" ? "全局" : "项目"} />
                    ))}
                  </div>
                </section>

                <section>
                  <SectionTitle>Skills</SectionTitle>
                  {resources.filter((item) => item.kind === "skill").length === 0 && <p className="text-xs text-muted-foreground">未发现 Skill</p>}
                  <div className="space-y-0.5">
                    {resources.filter((item) => item.kind === "skill").map((item) => (
                      <ListRow key={item.path} primary={item.name} secondary={item.source} />
                    ))}
                  </div>
                </section>

                <section>
                  <SectionTitle>Prompt 模板</SectionTitle>
                  {resources.filter((item) => item.kind === "prompt").length === 0 && <p className="text-xs text-muted-foreground">未发现 Prompt 模板</p>}
                  <div className="space-y-0.5">
                    {resources.filter((item) => item.kind === "prompt").map((item) => (
                      <ListRow key={item.path} primary={item.name} secondary={item.source} />
                    ))}
                  </div>
                </section>

                <section>
                  <SectionTitle>Pi 包（实验：经 pi CLI 安装到 settings.packages）</SectionTitle>
                  <div className="space-y-0.5">
                    {packages.map((spec) => (
                      <ListRow key={spec} primary={spec} />
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Input
                      className="min-w-0 flex-1"
                      placeholder="npm:@scope/pkg 或 git:user/repo"
                      value={pkgSpec}
                      onChange={(e) => setPkgSpec(e.target.value)}
                    />
                    <Button size="sm" disabled={!pkgSpec.trim()} onClick={installPackage}>安装</Button>
                  </div>
                  {pkgOutput && (
                    <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all text-muted-foreground">{pkgOutput}</pre>
                  )}
                </section>
              </div>
            )}

            {tab === "plugins" && <PluginsPanel />}

            {tab === "subagent" && <SubagentPermissionsPanel />}

            {tab === "memory" && <MemorySettingsPanel />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
