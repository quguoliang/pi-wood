import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingCard, SettingGroupLabel, SettingRow } from "../SettingRow";

/**
 * 扩展与包：已加载扩展 / Skills / Prompt 模板 / Pi 包安装（经 pi CLI）。
 * ⚠️ 安装是长任务（最长 2 分钟）：spec/output/running 状态提升到 SettingsPage 层受控传入，
 * 切走再回来（本组件卸载重挂）安装输出不丢；promises 的回调也持有页面层 setter。
 */
export interface PkgInstallState {
  spec: string;
  output: string;
  running: boolean;
}

interface ExtItem {
  source: string;
  name: string;
  path: string;
}
interface ResourceItem extends ExtItem {
  kind: "skill" | "prompt";
}

export function ExtSection({
  install,
  onSpecChange,
  onInstall,
}: {
  install: PkgInstallState;
  onSpecChange: (spec: string) => void;
  onInstall: () => void;
}): React.JSX.Element {
  const [extensions, setExtensions] = useState<ExtItem[]>([]);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [packages, setPackages] = useState<string[]>([]);

  useEffect(() => {
    void window.pi.extensionsList().then((r) => setExtensions(r as ExtItem[]));
    void window.pi.resourcesList().then((r) => setResources(r as ResourceItem[]));
    void window.pi.packagesList().then((r) => setPackages(r.packages));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <SettingGroupLabel
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => void window.pi.engineReload().then(() => toast.success("已重载扩展"))}
            >
              重载扩展
            </Button>
          }
        >
          已加载扩展（选中项目后点「重载」生效）
        </SettingGroupLabel>
        <SettingCard>
          {extensions.map((x) => (
            <SettingRow key={x.path} title={x.name}>
              <span className="text-xs text-muted-foreground">{x.source === "global" ? "全局" : "项目"}</span>
            </SettingRow>
          ))}
          {extensions.length === 0 && (
            <div className="px-5 py-4 text-xs text-muted-foreground">未发现扩展（全局 ~/.pi/agent/extensions 或项目 .pi/extensions）</div>
          )}
        </SettingCard>
      </div>

      <div>
        <SettingGroupLabel>Skills</SettingGroupLabel>
        <SettingCard>
          {resources
            .filter((item) => item.kind === "skill")
            .map((item) => (
              <SettingRow key={item.path} title={item.name}>
                <span className="max-w-64 truncate font-mono text-xs text-muted-foreground">{item.source}</span>
              </SettingRow>
            ))}
          {resources.filter((item) => item.kind === "skill").length === 0 && (
            <div className="px-5 py-4 text-xs text-muted-foreground">未发现 Skill</div>
          )}
        </SettingCard>
      </div>

      <div>
        <SettingGroupLabel>Prompt 模板</SettingGroupLabel>
        <SettingCard>
          {resources
            .filter((item) => item.kind === "prompt")
            .map((item) => (
              <SettingRow key={item.path} title={item.name}>
                <span className="max-w-64 truncate font-mono text-xs text-muted-foreground">{item.source}</span>
              </SettingRow>
            ))}
          {resources.filter((item) => item.kind === "prompt").length === 0 && (
            <div className="px-5 py-4 text-xs text-muted-foreground">未发现 Prompt 模板</div>
          )}
        </SettingCard>
      </div>

      <div>
        <SettingGroupLabel>Pi 包（实验：经 pi CLI 安装到 settings.packages）</SettingGroupLabel>
        <SettingCard>
          {packages.map((spec) => (
            <SettingRow key={spec} title={<span className="font-mono text-[13px]">{spec}</span>} />
          ))}
          <div className="flex items-center gap-2 px-5 py-4">
            <Input
              className="min-w-0 flex-1"
              placeholder="npm:@scope/pkg 或 git:user/repo"
              value={install.spec}
              onChange={(e) => onSpecChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && install.spec.trim() && !install.running) onInstall();
              }}
            />
            <Button size="sm" disabled={!install.spec.trim() || install.running} onClick={onInstall}>
              {install.running ? "安装中…" : "安装"}
            </Button>
          </div>
        </SettingCard>
        {install.output && (
          <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all text-muted-foreground">
            {install.output}
          </pre>
        )}
      </div>
    </div>
  );
}
