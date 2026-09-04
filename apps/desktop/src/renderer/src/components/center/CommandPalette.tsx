import { useEffect, useMemo, useRef, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { useActiveConversation } from "../../stores/session-store";

/**
 * T5.1 命令面板：Ctrl/Cmd+Shift+P 唤起；聚合 应用命令 + Pi/扩展/Skill/模板命令 + 模型 + 项目 + 文件。
 * 模糊搜索/键盘导航交给 cmdk（CommandDialog）。数据源全部复用既有 IPC / SDK session 公共成员：
 * 命令来自 engine:listCommands（扩展命令+prompt模板+skill），文件来自 fs:search（含 .gitignore 过滤）。
 * 执行方式：命令项把 `/{name} ` 注入输入框（replace），文件项把 `@{path}` 追加——均走真实引擎/输入路径，不重造。
 */
interface Cmd {
  id: string;
  label: string;
  hint?: string;
  run(): void;
}

type EngineCommand = { name: string; description?: string; source: "extension" | "prompt" | "skill" | "builtin" };

const SOURCE_GROUP: Record<EngineCommand["source"], string> = {
  extension: "扩展命令",
  prompt: "模板",
  skill: "Skill",
  builtin: "Pi 命令",
};

export function CommandPalette({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
}): React.JSX.Element {
  const [models, setModels] = useState<Array<{ provider: string; id: string }>>([]);
  const [projects, setProjects] = useState<Array<{ id: string; path: string; name: string }>>([]);
  const [engineCommands, setEngineCommands] = useState<EngineCommand[]>([]);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<Array<{ path: string; type: "dir" | "file" }>>([]);
  const engineReady = useActiveConversation((c) => c.engineReady);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (engineReady) {
      void window.pi.engineModels().then(setModels).catch(() => setModels([]));
      void window.pi.engineCommands().then(setEngineCommands).catch(() => setEngineCommands([]));
    } else {
      setModels([]);
      setEngineCommands([]);
    }
    void window.pi.projectList().then((r) => setProjects(r as typeof projects));
  }, [engineReady]);

  // 文件联想：查询 ≥2 字符时防抖 200ms 走 fs:search（依赖活动项目的引擎就绪）
  useEffect(() => {
    clearTimeout(searchTimer.current);
    const q = query.trim();
    if (!engineReady || q.length < 2) {
      setFiles([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      void window.pi
        .fsSearch(q)
        .then((r) => setFiles((r as typeof files).slice(0, 12)))
        .catch(() => setFiles([]));
    }, 200);
    return () => clearTimeout(searchTimer.current);
  }, [query, engineReady]);

  const insert = (text: string, replace: boolean): void => {
    window.dispatchEvent(new CustomEvent("piwood:composer-insert", { detail: { text, replace } }));
    onClose();
  };

  const base: Cmd[] = [
    { id: "settings", label: "打开设置", hint: "命令", run: onOpenSettings },
    { id: "new-session", label: "新建会话", hint: "命令", run: () => window.dispatchEvent(new Event("piwood:new-session")) },
    {
      id: "theme-light",
      label: "主题：切换到浅色",
      hint: "命令",
      run: () =>
        void window.pi.settingsSet({ theme: { fallback: "light" } }).then(() => {
          document.documentElement.dataset.theme = "light";
        }),
    },
    {
      id: "theme-dark",
      label: "主题：切换到深色",
      hint: "命令",
      run: () =>
        void window.pi.settingsSet({ theme: { fallback: "dark" } }).then(() => {
          document.documentElement.dataset.theme = "dark";
        }),
    },
  ];

  const engineCmds: Cmd[] = engineCommands.map((c) => ({
    id: `cmd-${c.source}-${c.name}`,
    label: `/${c.name}`,
    hint: c.description ?? SOURCE_GROUP[c.source],
    run: () => insert(`/${c.name} `, true),
  }));

  const modelCmds: Cmd[] = models.map((m) => ({
    id: `model-${m.provider}-${m.id}`,
    label: `切换模型：${m.provider}/${m.id}`,
    hint: "模型",
    run: () => {
      void window.pi.engineSetModel(m.provider, m.id);
      onClose();
    },
  }));

  const projectCmds: Cmd[] = projects.map((p) => ({
    id: `project-${p.id}`,
    label: `切换项目：${p.name}`,
    hint: p.path,
    run: () => {
      window.dispatchEvent(new CustomEvent("piwood:select-project", { detail: p.path }));
      onClose();
    },
  }));

  const fileCmds: Cmd[] = files.map((f) => ({
    id: `file-${f.path}`,
    label: f.path,
    hint: f.type === "dir" ? "目录" : "文件",
    run: () => insert(`@${f.path} `, false),
  }));

  // 按 source 分组引擎命令，保持稳定顺序
  const engineGroups = useMemo(() => {
    const order: EngineCommand["source"][] = ["extension", "skill", "prompt", "builtin"];
    const map = new Map<string, Cmd[]>();
    for (const src of order) {
      const items = engineCmds.filter((_, i) => engineCommands[i]?.source === src);
      if (items.length) map.set(SOURCE_GROUP[src], items);
    }
    return map;
  }, [engineCmds, engineCommands]);

  const exec = (cmd: Cmd | undefined): void => {
    if (!cmd) return;
    cmd.run();
  };

  return (
    <CommandDialog open title="命令面板" onOpenChange={(v) => { if (!v) onClose(); }}>
      <CommandInput value={query} onValueChange={setQuery} placeholder="搜索命令、模型、项目或文件…" />
      <CommandList>
        <CommandEmpty>无匹配结果</CommandEmpty>
        <CommandGroup heading="命令">
          {base.map((cmd) => (
            <CommandItem key={cmd.id} value={cmd.label} onSelect={() => exec(cmd)}>
              {cmd.label}
              {cmd.hint && <CommandShortcut>{cmd.hint}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
        {[...engineGroups.entries()].map(([heading, items]) => (
          <CommandGroup key={heading} heading={heading}>
            {items.map((cmd) => (
              <CommandItem key={cmd.id} value={cmd.label} onSelect={() => exec(cmd)}>
                {cmd.label}
                {cmd.hint && <CommandShortcut>{cmd.hint}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {modelCmds.length > 0 && (
          <CommandGroup heading="模型">
            {modelCmds.map((cmd) => (
              <CommandItem key={cmd.id} value={cmd.label} onSelect={() => exec(cmd)}>
                {cmd.label}
                {cmd.hint && <CommandShortcut>{cmd.hint}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {projectCmds.length > 0 && (
          <CommandGroup heading="项目">
            {projectCmds.map((cmd) => (
              <CommandItem key={cmd.id} value={cmd.label} onSelect={() => exec(cmd)}>
                {cmd.label}
                {cmd.hint && <CommandShortcut>{cmd.hint}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {fileCmds.length > 0 && (
          <CommandGroup heading="文件">
            {fileCmds.map((cmd) => (
              <CommandItem key={cmd.id} value={cmd.label} onSelect={() => exec(cmd)}>
                {cmd.label}
                {cmd.hint && <CommandShortcut>{cmd.hint}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
