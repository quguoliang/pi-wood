import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingCard, SettingRow } from "../SettingRow";

/**
 * 模型源：各 Provider 密钥录入（safeStorage 钥匙串，落 ~/.pi-wood/keys.json）。
 * 数据自拉（providerList），保存成功走 toast（旧 modal 的左栏小字反馈已废弃）。
 */
interface ProviderInfo {
  id: string;
  name: string;
  hasKey: boolean;
}

export function ProvidersSection(): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    void window.pi
      .providerList()
      .then((r) => setProviders((r as { builtin: ProviderInfo[] }).builtin ?? []))
      .catch(() => setProviders([]));
  }, []);

  const saveKey = (provider: string): void => {
    const key = keyDraft[provider];
    if (!key) return;
    void window.pi.providerSetKey(provider, key).then(() => {
      setKeyDraft((d) => ({ ...d, [provider]: "" }));
      setProviders((ps) => ps.map((p) => (p.id === provider ? { ...p, hasKey: true } : p)));
      toast.success("密钥已存入钥匙串（下次选择项目生效）");
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">密钥经系统钥匙串（DPAPI）加密存储于 ~/.pi-wood/keys.json</p>
      <SettingCard>
        {providers.map((p) => (
          <SettingRow
            key={p.id}
            title={`${p.name} · ${p.hasKey ? "已配置" : "未配置"}`}
            className="gap-4"
          >
            <Input
              type="password"
              className="h-8 w-64 text-xs"
              placeholder={p.hasKey ? "已配置（输入可覆盖）" : `${p.id.toUpperCase()}_API_KEY`}
              value={keyDraft[p.id] ?? ""}
              onChange={(e) => setKeyDraft((d) => ({ ...d, [p.id]: e.target.value }))}
            />
            <Button size="sm" variant="secondary" disabled={!keyDraft[p.id]} onClick={() => saveKey(p.id)}>
              保存
            </Button>
          </SettingRow>
        ))}
        {providers.length === 0 && (
          <div className="px-5 py-4 text-xs text-muted-foreground">正在读取 Provider 列表…</div>
        )}
      </SettingCard>
    </div>
  );
}
