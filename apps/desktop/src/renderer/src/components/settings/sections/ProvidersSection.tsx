import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Check, Plus, Trash2 } from "lucide-react";

/**
 * 模型源（供应商管理改版）：左列供应商清单（内置 + 自定义两组，状态圆点），右侧统一配置表单。
 * - 内置供应商：端点/API 格式/模型目录由引擎内置，只需录密钥；另开放「追加模型」
 *   （新模型发布但 SDK 目录未跟上时，按 id upsert 进内置目录，不碰端点——§8 红线）。
 * - 自定义供应商：名称 / Base URL / API Key / API 格式 + 完整模型清单，可增删改。
 * 密钥走 keys.json（safeStorage），models.json 只写 ${ENV} 占位；保存后引擎侧对空闲会话热重载。
 */

type ApiFormat = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";

const API_FORMATS: Array<{ value: ApiFormat; label: string }> = [
  { value: "openai-completions", label: "OpenAI Chat Completions (/v1/chat/completions)" },
  { value: "openai-responses", label: "OpenAI Responses (/v1/responses)" },
  { value: "anthropic-messages", label: "Anthropic Messages (/v1/messages)" },
  { value: "google-generative-ai", label: "Google Gemini (generateContent)" },
];

interface ModelCfg {
  id: string;
  contextWindow: number;
  maxTokens: number;
  input: string[];
}
interface BuiltinProvider {
  id: string;
  name: string;
  hasKey: boolean;
  /** 用户此前追加到该内置供应商的模型（models.json 同名条目的 models[]） */
  extraModels: ModelCfg[];
}
interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  hasKey: boolean;
  models: ModelCfg[];
}

/** 右栏自定义供应商表单草稿；id 缺席 = 新建 */
interface Draft {
  id?: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  api: ApiFormat;
  models: ModelCfg[];
  /** 编辑对象磁盘上是否已有密钥（决定 Key 输入框占位与「留空保留」语义） */
  hasStoredKey: boolean;
}

type Selection = { kind: "builtin"; id: string } | { kind: "custom"; id: string } | { kind: "new" };

const emptyDraft = (): Draft => ({ name: "", baseUrl: "", apiKey: "", api: "openai-completions", models: [], hasStoredKey: false });

const fmtNum = (n: number): string => n.toLocaleString("en-US");

export function ProvidersSection(): React.JSX.Element {
  const [builtin, setBuiltin] = useState<BuiltinProvider[]>([]);
  const [custom, setCustom] = useState<CustomProvider[]>([]);
  const [selected, setSelected] = useState<Selection>({ kind: "new" });
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const r = (await window.pi.providerList()) as { builtin?: BuiltinProvider[]; custom?: CustomProvider[] };
      const b = r.builtin ?? [];
      const c = r.custom ?? [];
      setBuiltin(b);
      setCustom(c);
      setSelected((cur) => {
        if (cur.kind === "custom" && !c.some((p) => p.id === cur.id)) return { kind: "new" };
        if (cur.kind === "builtin" && !b.some((p) => p.id === cur.id)) return { kind: "new" };
        return cur;
      });
    } catch {
      setBuiltin([]);
      setCustom([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const pickCustom = (p: CustomProvider): void => {
    setSelected({ kind: "custom", id: p.id });
    setConfirmRemove(false);
    setDraft({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: "",
      api: (API_FORMATS.some((f) => f.value === p.api) ? p.api : "openai-completions") as ApiFormat,
      models: p.models,
      hasStoredKey: p.hasKey,
    });
  };

  const startNew = (): void => {
    setSelected({ kind: "new" });
    setDraft(emptyDraft());
    setConfirmRemove(false);
  };

  const saveCustom = async (): Promise<void> => {
    const name = draft.name.trim();
    const baseUrl = draft.baseUrl.trim();
    if (!name) { toast.error("请填写供应商名称"); return; }
    if (!baseUrl) { toast.error("请填写 Base URL"); return; }
    if (draft.models.length === 0) { toast.error("请至少添加一个模型"); return; }
    if (!draft.apiKey.trim() && !draft.hasStoredKey) { toast.error("请填写 API Key"); return; }
    setSaving(true);
    try {
      const r = await window.pi.providerUpsertCustom({
        id: draft.id,
        name,
        baseUrl,
        apiKey: draft.apiKey.trim() || undefined,
        api: draft.api,
        models: draft.models,
      });
      toast.success(draft.id ? `已保存供应商「${name}」` : `已添加供应商「${name}」，模型即刻可选`);
      setDraft((d) => ({ ...d, id: r?.id ?? d.id, apiKey: "", hasStoredKey: true }));
      if (r?.id) setSelected({ kind: "custom", id: r.id });
      await reload();
    } catch (err) {
      toast.error(String((err as Error)?.message ?? err));
    } finally {
      setSaving(false);
    }
  };

  const removeCustom = async (): Promise<void> => {
    if (!draft.id) return;
    try {
      await window.pi.providerRemoveCustom(draft.id);
      toast(`已删除供应商「${draft.name}」`, { description: "models.json 条目与钥匙串密钥已一并清除" });
      startNew();
      await reload();
    } catch (err) {
      toast.error(String((err as Error)?.message ?? err));
    }
  };

  const selectedBuiltin = selected.kind === "builtin" ? builtin.find((p) => p.id === selected.id) : undefined;

  return (
    <div className="flex gap-10">
      {/* 左列：供应商清单（内置 / 自定义两组）+ 添加入口 */}
      <aside className="w-56 shrink-0">
        <p className="px-2 pb-1 text-[11px] text-muted-foreground">内置</p>
        <div className="space-y-0.5">
          {builtin.map((p) => (
            <ProviderItem
              key={p.id}
              label={p.name}
              dot={p.hasKey ? "ok" : "idle"}
              active={selected.kind === "builtin" && selected.id === p.id}
              onClick={() => setSelected({ kind: "builtin", id: p.id })}
            />
          ))}
        </div>
        <p className="px-2 pb-1 pt-4 text-[11px] text-muted-foreground">自定义供应商</p>
        <div className="space-y-0.5">
          {custom.map((p) => (
            <ProviderItem
              key={p.id}
              label={p.name}
              dot={p.hasKey && p.models.length > 0 ? "ok" : "idle"}
              active={selected.kind === "custom" && selected.id === p.id}
              onClick={() => pickCustom(p)}
            />
          ))}
          {custom.length === 0 && <p className="px-2 py-1 text-[11px] text-muted-foreground/60">暂无，点下方添加</p>}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-3 w-full justify-start gap-2 text-[13px]"
          onClick={startNew}
        >
          <Plus className="size-3.5" /> 添加供应商
        </Button>
      </aside>

      {/* 右栏：选中供应商的配置表单 */}
      <section className="min-w-0 flex-1 self-start rounded-xl border border-border/60 bg-card/40 p-6">
        {selectedBuiltin ? (
          <BuiltinForm key={selectedBuiltin.id} provider={selectedBuiltin} onSaved={() => void reload()} />
        ) : (
          <CustomProviderForm
            draft={draft}
            saving={saving}
            confirmRemove={confirmRemove}
            onDraftChange={setDraft}
            onSave={() => void saveCustom()}
            onRemove={() => (confirmRemove ? void removeCustom() : setConfirmRemove(true))}
            onCancelRemove={() => setConfirmRemove(false)}
          />
        )}
      </section>
    </div>
  );
}

function ProviderItem({
  label,
  dot,
  active,
  onClick,
}: {
  label: string;
  dot: "ok" | "idle";
  active: boolean;
  onClick(): void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]",
        active ? "bg-sidebar-accent font-medium text-sidebar-foreground" : "text-muted-foreground hover:bg-sidebar-accent/25 hover:text-sidebar-foreground",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", dot === "ok" ? "bg-success" : "bg-muted-foreground/30")}
        title={dot === "ok" ? "已配置" : "未配置"}
      />
    </button>
  );
}

/* ---------------- 内置供应商：密钥 + 追加模型 ---------------- */

function BuiltinForm({
  provider,
  onSaved,
}: {
  provider: BuiltinProvider;
  onSaved(): void;
}): React.JSX.Element {
  const [key, setKey] = useState("");
  const [models, setModels] = useState<ModelCfg[]>(provider.extraModels);
  const [saving, setSaving] = useState(false);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      if (key.trim()) await window.pi.providerSetKey(provider.id, key.trim());
      await window.pi.providerSetBuiltinModels(provider.id, models);
      toast.success(
        key.trim() ? "密钥已存入钥匙串（下次选择项目生效）" : "模型清单已更新（空闲会话即时生效）",
      );
      setKey("");
      onSaved();
    } catch (err) {
      toast.error(String((err as Error)?.message ?? err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{provider.name}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {provider.hasKey ? "已配置密钥（输入可覆盖）" : "未配置"} · 端点与 API 格式由引擎内置目录提供，只需录入密钥。
        </p>
      </div>
      <FormField label="API Key">
        <Input
          type="password"
          placeholder={`${provider.id.toUpperCase()}_API_KEY`}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </FormField>
      <FormField label="追加模型（可选）">
        <p className="pb-2 text-[11px] leading-relaxed text-muted-foreground">
          新模型发布但引擎目录还没收录时，在这里按模型 ID 追加；请求仍走该供应商的内置端点与格式。
        </p>
        <ModelListEditor models={models} onChange={setModels} />
      </FormField>
      <div className="flex justify-end border-t border-border/60 pt-4">
        <Button size="sm" disabled={saving || (!key.trim() && sameModels(models, provider.extraModels))} onClick={() => void save()}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );
}

const sameModels = (a: ModelCfg[], b: ModelCfg[]): boolean => JSON.stringify(a) === JSON.stringify(b);

/* ---------------- 自定义供应商表单 ---------------- */

function CustomProviderForm({
  draft,
  saving,
  confirmRemove,
  onDraftChange,
  onSave,
  onRemove,
  onCancelRemove,
}: {
  draft: Draft;
  saving: boolean;
  confirmRemove: boolean;
  onDraftChange(d: Draft): void;
  onSave(): void;
  onRemove(): void;
  onCancelRemove(): void;
}): React.JSX.Element {
  const isEdit = Boolean(draft.id);
  const set = (patch: Partial<Draft>): void => onDraftChange({ ...draft, ...patch });
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{isEdit ? `编辑模型供应商 · ${draft.name || draft.id}` : "添加模型供应商"}</h2>
        <p className="mt-1 text-xs text-muted-foreground">配置一个完全自定义的 API 端点和初始模型。</p>
      </div>

      <FormField label="名称">
        <Input placeholder="如：智谱 GLM" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
      </FormField>
      <FormField label="Base URL">
        <Input
          placeholder="https://api.example.com/v1"
          value={draft.baseUrl}
          onChange={(e) => set({ baseUrl: e.target.value })}
        />
      </FormField>
      <FormField label="API Key">
        <Input
          type="password"
          placeholder={draft.hasStoredKey ? "已配置（留空保留现有密钥）" : "输入 API Key"}
          value={draft.apiKey}
          onChange={(e) => set({ apiKey: e.target.value })}
        />
      </FormField>
      <FormField label="API 格式">
        <Select value={draft.api} onValueChange={(v) => set({ api: v as ApiFormat })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {API_FORMATS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormField label="模型列表">
        <ModelListEditor models={draft.models} onChange={(models) => set({ models })} />
      </FormField>

      <div className="flex items-center justify-between border-t border-border/60 pt-4">
        <p className={cn("text-xs", draft.models.length === 0 ? "text-muted-foreground" : "text-transparent")}>
          {isEdit ? "保存后立即对空闲会话热生效" : "添加供应商前，请至少添加一个模型。"}
        </p>
        <div className="flex items-center gap-2">
          {isEdit && (
            confirmRemove ? (
              <span className="flex items-center gap-1.5 text-xs text-destructive">
                确认删除？密钥一并清除
                <Button size="sm" variant="destructive" onClick={onRemove}>删除</Button>
                <Button size="sm" variant="ghost" onClick={onCancelRemove}>取消</Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={onRemove}>
                删除供应商
              </Button>
            )
          )}
          <Button size="sm" disabled={saving} onClick={onSave}>
            {saving ? "保存中…" : isEdit ? "保存" : "添加供应商"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/* ---------------- 共享：模型清单 + 添加/编辑弹窗（参考稿图三） ---------------- */

function ModelListEditor({
  models,
  onChange,
}: {
  models: ModelCfg[];
  onChange(models: ModelCfg[]): void;
}): React.JSX.Element {
  const [dialog, setDialog] = useState<{ editingIndex: number | null } | null>(null);
  return (
    <div className="space-y-2">
      {models.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2.5 text-xs text-muted-foreground">
          当前没有配置模型，添加模型后可在聊天中使用。
        </div>
      )}
      {models.map((m, i) => (
        <div key={m.id} className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDialog({ editingIndex: i })}>
            <span className="block truncate text-[13px]">{m.id}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              上下文 {fmtNum(m.contextWindow)} · 最大输出 {fmtNum(m.maxTokens)} · {m.input.join("/")}
            </span>
          </button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`删除模型 ${m.id}`}
            className="size-7 text-muted-foreground hover:text-foreground"
            onClick={() => onChange(models.filter((_, j) => j !== i))}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDialog({ editingIndex: null })}>
        <Plus className="size-3.5" /> 添加模型
      </Button>
      {dialog && (
        <AddModelDialog
          editing={dialog.editingIndex != null ? models[dialog.editingIndex] : undefined}
          existingIds={models.filter((_, i) => i !== dialog.editingIndex).map((m) => m.id)}
          onClose={() => setDialog(null)}
          onSubmit={(model) => {
            onChange(
              dialog.editingIndex != null
                ? models.map((m, i) => (i === dialog.editingIndex ? model : m))
                : [...models, model],
            );
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

const MODALITIES: Array<{ key: "text" | "image" | "video" | "pdf"; label: string; sdkSupported: boolean }> = [
  { key: "text", label: "文本", sdkSupported: true },
  { key: "image", label: "图片", sdkSupported: true },
  { key: "video", label: "视频", sdkSupported: false },
  { key: "pdf", label: "PDF", sdkSupported: false },
];

function AddModelDialog({
  editing,
  existingIds,
  onClose,
  onSubmit,
}: {
  editing?: ModelCfg;
  existingIds: string[];
  onClose(): void;
  onSubmit(model: ModelCfg): void;
}): React.JSX.Element {
  const [id, setId] = useState(editing?.id ?? "");
  const [ctx, setCtx] = useState(String(editing?.contextWindow ?? 1_000_000));
  const [maxOut, setMaxOut] = useState(String(editing?.maxTokens ?? 128_000));
  const [input, setInput] = useState<Record<string, boolean>>(() => {
    const base: Record<string, boolean> = { text: true, image: false, video: false, pdf: false };
    for (const m of editing?.input ?? ["text"]) base[m] = true;
    return base;
  });

  const submit = (): void => {
    const trimmed = id.trim();
    if (!trimmed) { toast.error("请填写模型 ID"); return; }
    if (existingIds.includes(trimmed)) { toast.error(`模型 ${trimmed} 已在清单中`); return; }
    const contextWindow = Number(ctx);
    const maxTokens = Number(maxOut);
    if (!Number.isInteger(contextWindow) || contextWindow <= 0) { toast.error("上下文窗口需为正整数"); return; }
    if (!Number.isInteger(maxTokens) || maxTokens <= 0) { toast.error("最大输出 Token 需为正整数"); return; }
    const inputList = MODALITIES.filter((m) => m.sdkSupported && input[m.key]).map((m) => m.key);
    onSubmit({ id: trimmed, contextWindow, maxTokens, input: inputList.length > 0 ? inputList : ["text"] });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑模型" : "添加模型"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <FormField label="模型 ID">
            <Input placeholder="模型 ID" value={id} onChange={(e) => setId(e.target.value)} autoFocus />
          </FormField>
          <FormField label="上下文窗口">
            <Input inputMode="numeric" value={ctx} onChange={(e) => setCtx(e.target.value.replace(/[^\d]/g, ""))} />
          </FormField>
          <FormField label="最大输出 Token">
            <Input inputMode="numeric" value={maxOut} onChange={(e) => setMaxOut(e.target.value.replace(/[^\d]/g, ""))} />
          </FormField>
          <FormField label="输入类型">
            <div className="flex flex-wrap gap-2">
              {MODALITIES.map((m) => {
                const locked = m.key === "text";
                const checked = locked || Boolean(input[m.key]);
                return (
                  <button
                    key={m.key}
                    type="button"
                    disabled={locked || !m.sdkSupported}
                    title={!m.sdkSupported ? "引擎暂不支持该输入类型，勾选不会保存" : locked ? "文本为必备类型" : undefined}
                    onClick={() => setInput((s) => ({ ...s, [m.key]: !s[m.key] }))}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
                      checked ? "border-primary/60 bg-primary/10 text-foreground" : "border-border/70 text-muted-foreground hover:text-foreground",
                      (locked || !m.sdkSupported) && "cursor-default opacity-70",
                    )}
                  >
                    <span className={cn("grid size-3.5 place-items-center rounded border", checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
                      {checked && <Check className="size-2.5" />}
                    </span>
                    {m.label}
                    {locked && <span className="text-[10px] text-muted-foreground/70">必备</span>}
                  </button>
                );
              })}
            </div>
          </FormField>
          <FormField label="输出类型">
            <div className="flex w-fit items-center gap-1.5 rounded-md border border-primary/60 bg-primary/10 px-2.5 py-1 text-xs">
              <span className="grid size-3.5 place-items-center rounded border border-primary bg-primary text-primary-foreground">
                <Check className="size-2.5" />
              </span>
              文本<span className="text-[10px] text-muted-foreground/70">必备</span>
            </div>
          </FormField>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" onClick={submit}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
