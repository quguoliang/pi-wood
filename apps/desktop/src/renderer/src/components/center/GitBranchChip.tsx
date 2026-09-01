import { useState } from "react";
import type { GitInfo } from "@pi-wood/ipc-schema";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Icon } from "../ui/Icon";
import { openWorkbench } from "../../stores/workbench-store";

/**
 * 空态对话框头部的 git 分支芯片：仅当项目是 git 仓库（有分支）时渲染，否则不占位。
 * 展示当前分支与未提交变更数，点击可跳到右栏「变更」面板（不臆造建分支/图谱等未接线能力）。
 */
export function GitBranchChip({ git }: { git: GitInfo | undefined }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (!git || !git.branch) return null;
  const changed = git.changed ?? 0;

  const viewChanges = (): void => {
    setOpen(false);
    openWorkbench("diff");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 rounded-md px-2 text-xs font-normal text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Git 分支"
        >
          <Icon name="gitBranch" className="size-3.5" />
          <span className="max-w-[10rem] truncate">{git.branch}</span>
          <Icon name="chevronDown" className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 gap-0.5 p-1.5">
        <div className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">分支</div>
        <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2">
          <Icon name="gitBranch" className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] text-foreground">{git.branch}</span>
            <span className="block text-[11px] text-muted-foreground">
              {changed > 0 ? `未提交的更改：${changed} 个文件` : "工作区干净"}
            </span>
          </span>
        </div>
        {changed > 0 && (
          <>
            <div className="my-1 h-px bg-border" />
            <button type="button" onClick={viewChanges} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent">
              <Icon name="listChecks" className="size-4 text-muted-foreground" />
              <span className="text-[13px] text-foreground">查看变更</span>
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
