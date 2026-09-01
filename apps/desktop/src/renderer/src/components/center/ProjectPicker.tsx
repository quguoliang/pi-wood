import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Icon } from "../ui/Icon";

interface ProjectRecord {
  id: string;
  path: string;
  name: string;
}

/**
 * 空态对话框头部的项目/工作区选择芯片。
 * 数据与激活均由左栏 useSidebarProjects 单一持有——本组件只读列表并派发全局事件：
 * 选已有项目 → piwood:select-project(detail: path)；打开文件夹 → piwood:add-project。
 */
export function ProjectPicker({ activeProject }: { activeProject: string | undefined }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [query, setQuery] = useState("");
  const currentName = activeProject?.split(/[\\/]/).filter(Boolean).pop();

  useEffect(() => {
    if (!open) return;
    setQuery("");
    void (window.pi.projectList() as Promise<ProjectRecord[]>).then(setProjects).catch(() => setProjects([]));
  }, [open]);

  const filtered = query.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()) || p.path.toLowerCase().includes(query.trim().toLowerCase()))
    : projects;

  const pick = (path: string): void => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent("piwood:select-project", { detail: path }));
  };
  const addFolder = (): void => {
    setOpen(false);
    window.dispatchEvent(new Event("piwood:add-project"));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 rounded-md px-2 text-xs font-normal text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="选择项目"
        >
          <Icon name={activeProject ? "folder" : "folderOpen"} className="size-3.5" />
          <span className="max-w-[10rem] truncate">{currentName ?? "选择项目"}</span>
          <Icon name="chevronDown" className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 gap-1 p-1.5">
        <div className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-muted-foreground focus-within:bg-accent/50">
          <Icon name="search" className="size-3.5" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索工作区"
            className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="my-1 h-px bg-border" />
        <div className="max-h-64 overflow-auto">
          {filtered.length === 0 && <p className="px-2.5 py-2 text-[12px] text-muted-foreground">没有匹配的工作区。</p>}
          {filtered.map((project) => (
            <button
              key={project.path}
              type="button"
              onClick={() => pick(project.path)}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent"
            >
              <Icon name="folder" className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{project.name}</span>
              {project.path === activeProject && <Icon name="check" className="size-4 text-success" />}
            </button>
          ))}
        </div>
        <div className="my-1 h-px bg-border" />
        <button type="button" onClick={addFolder} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent">
          <Icon name="folderOpen" className="size-4 text-muted-foreground" />
          <span className="text-[13px] text-foreground">打开文件夹…</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
