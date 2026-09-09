import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingCard, SettingRow } from "../SettingRow";

/** 主题：light/dark/system 回退档（pi 主题在主题商店侧另有覆盖）。选择即存并即时生效。 */
export function ThemeSection(): React.JSX.Element {
  const [theme, setTheme] = useState<string>("dark");

  useEffect(() => {
    void window.pi.settingsGet().then((s) => {
      const st = s as { theme?: { fallback?: string } };
      if (st.theme?.fallback) setTheme(st.theme.fallback);
    });
  }, []);

  const saveTheme = (fallback: string): void => {
    setTheme(fallback);
    void window.pi.settingsSet({ theme: { fallback: fallback as "light" | "dark" | "system" } });
    document.documentElement.dataset.theme = fallback;
  };

  return (
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
  );
}
