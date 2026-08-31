import { useEffect, useState } from "react";

/**
 * T3.2/T3.3 设置弹窗：Providers 密钥（safeStorage 钥匙串）/ 模型默认 / 审批策略 / 主题。
 */
interface ProviderInfo {
  id: string;
  name: string;
  hasKey: boolean;
}

export function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<"providers" | "model" | "approval" | "theme" | "ext">("providers");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  const [models, setModels] = useState<Array<{ provider: string; id: string }>>([]);
  const [model, setModel] = useState<{ provider: string; id: string }>({ provider: "", id: "" });
  const [approvalMode, setApprovalMode] = useState<string>("highRisk");
  const [theme, setTheme] = useState<string>("dark");
  const [saved, setSaved] = useState("");
  const [extensions, setExtensions] = useState<Array<{ source: string; name: string; path: string }>>([]);
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
    void window.pi.engineModels().then(setModels).catch(() => setModels([]));
    void window.pi.extensionsList().then((r) => setExtensions(r as typeof extensions));
    void window.pi.packagesList().then((r) => setPackages(r.packages));
    void window.pi.settingsGet().then((s) => {
      const st = s as { model?: { provider: string; id: string }; approval?: { mode: string }; theme?: { fallback: string } };
      if (st.model) setModel(st.model);
      if (st.approval?.mode) setApprovalMode(st.approval.mode);
      if (st.theme?.fallback) setTheme(st.theme.fallback);
    });
  }, []);

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
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>设置</b>
          <span className="muted">{saved}</span>
          <button className="ghost-btn" onClick={onClose}>关闭</button>
        </div>
        <div className="modal-tabs">
          <button className={tab === "providers" ? "active" : ""} onClick={() => setTab("providers")}>模型源</button>
          <button className={tab === "model" ? "active" : ""} onClick={() => setTab("model")}>默认模型</button>
          <button className={tab === "approval" ? "active" : ""} onClick={() => setTab("approval")}>审批策略</button>
          <button className={tab === "theme" ? "active" : ""} onClick={() => setTab("theme")}>主题</button>
          <button className={tab === "ext" ? "active" : ""} onClick={() => setTab("ext")}>扩展与包</button>
        </div>

        {tab === "providers" && (
          <div className="modal-body">
            <p className="muted">密钥经系统钥匙串（DPAPI）加密存储于 ~/.pi-desktop/keys.json</p>
            {providers.map((p) => (
              <div key={p.id} className="provider-row">
                <span className="provider-name">
                  {p.name} · {p.hasKey ? "已配置" : "未配置"}
                </span>
                <input
                  type="password"
                  placeholder={p.hasKey ? "已配置（输入可覆盖）" : `${p.id.toUpperCase()}_API_KEY`}
                  value={keyDraft[p.id] ?? ""}
                  onChange={(e) => setKeyDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                />
                <button className="ghost-btn" disabled={!keyDraft[p.id]} onClick={() => saveKey(p.id)}>保存</button>
              </div>
            ))}
          </div>
        )}

        {tab === "model" && (
          <div className="modal-body">
            <p className="muted">可用模型（需先在左栏选择项目以启动引擎）</p>
            {models.length === 0 && <p className="muted">(未获取到模型列表)</p>}
            <div className="model-list">
              {models.map((m) => (
                <label key={`${m.provider}/${m.id}`} className="model-row">
                  <input
                    type="radio"
                    name="default-model"
                    checked={model.provider === m.provider && model.id === m.id}
                    onChange={() => setModel(m)}
                  />
                  {m.provider} / {m.id}
                </label>
              ))}
            </div>
            <button className="ghost-btn" onClick={saveDefaultModel}>设为默认</button>
          </div>
        )}

        {tab === "approval" && (
          <div className="modal-body">
            <p className="muted">四档策略（§9）：敏感文件（.env/.git/.ssh 等）始终拦截</p>
            {[
              ["auto", "全自动（不询问）"],
              ["highRisk", "高风险审批（bash/edit/write 需确认）"],
              ["allAsk", "全部审批"],
              ["denyAll", "全部拒绝"],
            ].map(([mode, label]) => (
              <label key={mode} className="model-row">
                <input
                  type="radio"
                  name="approval-mode"
                  checked={approvalMode === mode}
                  onChange={() => saveApproval(mode)}
                />
                {label}
              </label>
            ))}
          </div>
        )}

        {tab === "theme" && (
          <div className="modal-body">
            {["dark", "light", "system"].map((t) => (
              <label key={t} className="model-row">
                <input
                  type="radio"
                  name="theme"
                  checked={theme === t}
                  onChange={() => saveTheme(t)}
                />
                {t}
              </label>
            ))}
          </div>
        )}

        {tab === "ext" && (
          <div className="modal-body">
            <div className="pane-header">
              <b className="muted">已加载扩展（选中项目后点"重载"生效）</b>
              <button className="ghost-btn" onClick={() => void window.pi.engineReload().then(() => flash("已重载扩展"))}>
                重载扩展
              </button>
            </div>
            {extensions.length === 0 && <p className="muted">未发现扩展（全局 ~/.pi/agent/extensions 或项目 .pi/extensions）</p>}
            {extensions.map((x) => (
              <div key={x.path} className="model-row">
                <span className="provider-name">{x.name}</span>
                <span className="muted">{x.source === "global" ? "全局" : "项目"}</span>
              </div>
            ))}
            <div className="pane-header" style={{ marginTop: 10 }}>
              <b className="muted">Pi 包（实验：经 pi CLI 安装到 settings.packages）</b>
            </div>
            {packages.map((spec) => (
              <div key={spec} className="model-row">{spec}</div>
            ))}
            <div className="provider-row">
              <input
                placeholder="npm:@scope/pkg 或 git:user/repo"
                value={pkgSpec}
                onChange={(e) => setPkgSpec(e.target.value)}
                style={{ flex: 1, padding: "5px 9px", fontSize: 12 }}
              />
              <button className="ghost-btn" disabled={!pkgSpec.trim()} onClick={installPackage}>安装</button>
            </div>
            {pkgOutput && <pre className="approval-body">{pkgOutput}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}
