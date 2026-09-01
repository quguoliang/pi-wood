import { useEffect, useMemo, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { useSessionStore } from "../../stores/session-store";

/**
 * T5.1 命令面板：Ctrl/Cmd+Shift+P 唤起；聚合应用命令 + 默认模型 + 项目切换。
 * 模糊搜索/键盘导航交给 cmdk（CommandDialog），命令项列表与执行回调不变。
 */
interface Command {
  id: string;
  label: string;
  hint?: string;
  run(): void | Promise<void>;
}

export function CommandPalette({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
}): React.JSX.Element {
  const [models, setModels] = useState<Array<{ provider: string; id: string }>>([]);
  const [projects, setProjects] = useState<Array<{ id: string; path: string; name: string }>>([]);
  const engineReady = useSessionStore((s) => s.engineReady);

  useEffect(() => {
    // 模型列表依赖引擎；未就绪时不拉取（§8 状态不变量）
    if (engineReady) void window.pi.engineModels().then(setModels).catch(() => setModels([]));
    else setModels([]);
    void window.pi.projectList().then((r) => setProjects(r as typeof projects));
  }, [engineReady]);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { id: "settings", label: "打开设置", run: onOpenSettings },
      {
        id: "new-session",
        label: "新建会话",
        run: () => void window.pi.engineNewSession(),
      },
      {
        id: "theme-light",
        label: "主题：切换到浅色",
        run: () =>
          void window.pi.settingsSet({ theme: { fallback: "light" } }).then(() => {
            document.documentElement.dataset.theme = "light";
          }),
      },
      {
        id: "theme-dark",
        label: "主题：切换到深色",
        run: () =>
          void window.pi.settingsSet({ theme: { fallback: "dark" } }).then(() => {
            document.documentElement.dataset.theme = "dark";
          }),
      },
    ];
    const modelCmds: Command[] = models.map((m) => ({
      id: `model-${m.provider}-${m.id}`,
      label: `切换模型：${m.provider}/${m.id}`,
      hint: "模型",
      run: () => void window.pi.engineSetModel(m.provider, m.id),
    }));
    const projectCmds: Command[] = projects.map((p) => ({
      id: `project-${p.id}`,
      label: `切换项目：${p.name}`,
      hint: p.path,
      run: () => {
        // 复用左栏选择逻辑的最小路径：选项目由 LeftPane 状态管理，
        // 面板命令仅导航（点击左栏条目完成完整切换）
        window.dispatchEvent(new CustomEvent("piwood:select-project", { detail: p.path }));
      },
    }));
    return [...base, ...modelCmds, ...projectCmds];
  }, [models, projects, onOpenSettings]);

  const exec = (cmd: Command | undefined): void => {
    if (!cmd) return;
    void cmd.run();
    onClose();
  };

  return (
    <CommandDialog open title="命令面板" onOpenChange={(v) => { if (!v) onClose(); }}>
      <CommandInput placeholder="输入命令或搜索…" />
      <CommandList>
        <CommandEmpty>无匹配命令</CommandEmpty>
        <CommandGroup heading="命令">
          {commands.map((cmd) => (
            <CommandItem key={cmd.id} value={cmd.label} onSelect={() => exec(cmd)}>
              {cmd.label}
              {cmd.hint && <CommandShortcut>{cmd.hint}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
