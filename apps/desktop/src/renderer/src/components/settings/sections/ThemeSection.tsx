import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SettingCard, SettingRow } from "../SettingRow";

/**
 * 外观设置：
 * - 配色模式：light/dark/system 回退档（pi 主题在主题商店侧另有覆盖），选择即存并即时生效；
 * - 磨砂玻璃侧边栏：系统级 vibrancy(macOS) / acrylic(Win11 22H2+)，整块 chrome 透出桌面模糊。
 *   因 transparent 是建窗期一次性属性，改后**重启生效**（这里存偏好，主进程下次建窗读取）。
 */
export function ThemeSection(): React.JSX.Element {
  const [theme, setTheme] = useState<string>("dark");
  const [glass, setGlass] = useState<boolean>(true);
  // 磨砂玻璃仅 macOS（vibrancy）/ Windows（acrylic，需 11 22H2+，旧系统主进程自动降级）支持；Linux 隐藏。
  const glassPlatform = window.pi.platform === "darwin" || window.pi.platform === "win32";
  // 生效态 = 本次建窗主进程实际启用的值；与待存值不一致即「已改待重启」。
  const effectiveGlass = window.pi.glass;

  useEffect(() => {
    void window.pi.settingsGet().then((s) => {
      const st = s as { theme?: { fallback?: string }; appearance?: { glass?: boolean } };
      if (st.theme?.fallback) setTheme(st.theme.fallback);
      setGlass(st.appearance?.glass !== false);
    });
  }, []);

  const saveTheme = (fallback: string): void => {
    setTheme(fallback);
    void window.pi.settingsSet({ theme: { fallback: fallback as "light" | "dark" | "system" } });
    document.documentElement.dataset.theme = fallback;
  };

  const saveGlass = (next: boolean): void => {
    setGlass(next);
    void window.pi.settingsSet({ appearance: { glass: next } });
  };

  return (
    <>
      <SettingCard>
        <SettingRow title="配色模式" description="界面明暗；「system」跟随 macOS / Windows 系统设置">
          <Select value={theme} onValueChange={saveTheme}>
            <SelectTrigger className="w-40" size="sm">
              <SelectValue placeholder="选择主题" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">深色 dark</SelectItem>
              <SelectItem value="light">浅色 light</SelectItem>
              <SelectItem value="system">跟随系统</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingCard>

      {glassPlatform && (
        <SettingCard>
          <SettingRow
            title="磨砂玻璃侧边栏"
            description={
              <>
                整块 chrome 透出桌面模糊（macOS 原生 vibrancy / Windows 11 22H2+ 亚克力），中/右卡片保持不透明。
                {window.pi.platform === "win32" && " 旧版 Windows 不支持时自动降级为实色。"}{" "}
                {glass !== effectiveGlass && <span className="text-warning">改动后重启应用生效。</span>}
              </>
            }
          >
            <Switch checked={glass} onCheckedChange={saveGlass} aria-label="磨砂玻璃侧边栏" />
          </SettingRow>
        </SettingCard>
      )}
    </>
  );
}
