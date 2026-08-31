import { useEffect, useMemo, useRef, useState } from "react";

/**
 * T5.1 命令面板：Ctrl/Cmd+Shift+P 唤起；聚合应用命令 + 默认模型 + 项目切换。
 * 轻量自研（cmdk 引入推迟到需要分组/多源聚合时）。
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
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [models, setModels] = useState<Array<{ provider: string; id: string }>>([]);
  const [projects, setProjects] = useState<Array<{ id: string; path: string; name: string }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    void window.pi.engineModels().then(setModels).catch(() => setModels([]));
    void window.pi.projectList().then((r) => setProjects(r as typeof projects));
  }, []);

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  const exec = (cmd: Command | undefined): void => {
    if (!cmd) return;
    void cmd.run();
    onClose();
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="输入命令或搜索…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === "Enter") {
              exec(filtered[cursor]);
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
        />
        <div className="palette-list">
          {filtered.length === 0 && <div className="muted" style={{ padding: "8px 12px" }}>无匹配命令</div>}
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              className={`palette-item ${i === cursor ? "active" : ""}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => exec(cmd)}
            >
              {cmd.label}
              {cmd.hint && <span className="muted palette-hint">{cmd.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
