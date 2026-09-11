import { useEffect, useState } from "react";
import { GitBranch, FolderGit2, Check } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useWorktreeAskStore } from "../../stores/worktree-ask-store";

/**
 * 「新任务在哪个工作区继续」选择弹框：主工作树有未提交改动时，新建会话前弹出。
 * 两个动作按钮（当前分支 / 新建独立工作树）各带风险说明，外加「不再询问」勾选——
 * 勾选后把所选回落到全局 worktree.mode，后续不再弹。必须由用户显式二选一（禁 esc/遮罩关闭，
 * 否则 send() 的 await 会悬挂）。
 */
export function WorktreeAskDialog(): React.JSX.Element {
  const open = useWorktreeAskStore((s) => s.open);
  const branch = useWorktreeAskStore((s) => s.branch);
  const answer = useWorktreeAskStore((s) => s.answer);
  const [remember, setRemember] = useState(false);
  // 每次打开复位勾选，避免上次泄漏
  useEffect(() => {
    if (open) setRemember(false);
  }, [open]);

  const pick = (choice: "worktree" | "current"): void => answer(choice, remember);

  return (
    <Dialog open={open} onOpenChange={(next) => { void next; /* 只能显式选择，忽略 esc/遮罩关闭 */ }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新任务在哪个工作区继续？</DialogTitle>
          <DialogDescription>
            当前分支 <span className="font-mono text-foreground/80">{branch || "（未知）"}</span> 有未提交的改动。
            选择这条对话的引擎在哪里运行——两种选择都有代价，请先看清风险。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => pick("current")}
            className={cn(
              "group flex w-full items-start gap-3 rounded-lg border border-border/70 px-3 py-2.5 text-left transition-colors hover:border-primary/60 hover:bg-accent/40",
            )}
          >
            <GitBranch className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-foreground">当前分支（主工作树）</span>
              <span className="block text-[11.5px] leading-relaxed text-muted-foreground">
                引擎直接在你当前目录改文件，能看到你未提交的改动。风险：与你的改动、以及同项目其它对话互相覆盖。
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => pick("worktree")}
            className={cn(
              "group flex w-full items-start gap-3 rounded-lg border border-border/70 px-3 py-2.5 text-left transition-colors hover:border-primary/60 hover:bg-accent/40",
            )}
          >
            <FolderGit2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-foreground">新建独立工作树</span>
              <span className="block text-[11.5px] leading-relaxed text-muted-foreground">
                在 &lt;项目&gt;/.pi-wood/worktrees/ 下开一棵物理隔离的 git worktree。风险：它是 HEAD 的干净检出，
                <b className="font-medium text-foreground/80">不含你未提交的改动</b>，完成后需回流到主工作树。
              </span>
            </span>
          </button>
        </div>

        <label className="mt-1 flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          <span className="grid size-3.5 shrink-0 place-items-center rounded border border-muted-foreground/40 transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground">
            {remember ? <Check className="size-2.5" /> : null}
          </span>
          不再询问，以后新任务默认按我的选择
        </label>
      </DialogContent>
    </Dialog>
  );
}
