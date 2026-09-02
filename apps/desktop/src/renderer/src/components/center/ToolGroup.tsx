import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown, CircleCheck, CircleX, Loader2 } from "lucide-react";
import { ToolCard } from "@pi-wood/ui-kit";
import { useSettingsStore } from "../../stores/settings-store";
import { useToolGroupsStore } from "../../stores/tool-groups-store";
import type { ToolGroupItem } from "../../lib/tool-groups";

function fmtSeconds(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${Math.round(s % 60)}s`;
}

/**
 * T5.6 连续工具分组：把一段连续工具调用折叠成一行组头（数量 / 状态 / 总耗时 / 成功失败计数），
 * 点击展开后组内逐条渲染 ToolCard（复用其独立展开态）。视觉上用淡灰圆角条与单条无边框工具行区分。
 * 全局 Ctrl+Shift+E 经 tool-groups-store 的 nonce 一次性把所有组同步为展开/收起。
 */
export const ToolGroup = memo(function ToolGroup({ group }: { group: ToolGroupItem }): React.JSX.Element {
  const defaultOpen = useSettingsStore((s) => s.settings.ui.toolGroupsDefaultOpen);
  const cardDefaultOpen = useSettingsStore((s) => s.settings.ui.toolCardsDefaultOpen);
  const nonce = useToolGroupsStore((s) => s.nonce);
  const [open, setOpen] = useState<boolean>(() => (group.status === "running" ? true : defaultOpen));
  const userTouched = useRef(false);
  const prevStatus = useRef(group.status);

  // 全局快捷键：nonce 变化（>=1）时把本组同步为全局值（一次性应用，不锁定后续单独折叠）。
  useEffect(() => {
    if (nonce === 0) return;
    setOpen(useToolGroupsStore.getState().allOpen);
  }, [nonce]);

  // 运行中 → 完成：未被手动/全局操作过时按 defaultOpen 收起，避免长任务列表持续占用高度。
  useEffect(() => {
    if (prevStatus.current === "running" && group.status !== "running" && !userTouched.current) {
      setOpen(defaultOpen);
    }
    prevStatus.current = group.status;
  }, [group.status, defaultOpen]);

  const toggle = (): void => {
    userTouched.current = true;
    setOpen((v) => !v);
  };

  const running = group.status === "running";
  const hasError = group.status === "has_error";

  return (
    <div className="group/tg">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1 text-left text-[12.5px] text-muted-foreground transition-colors hover:bg-muted/50"
      >
        {running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
        ) : hasError ? (
          <CircleX className="size-3.5 shrink-0 text-destructive/70" />
        ) : (
          <CircleCheck className="size-3.5 shrink-0 text-success/80" />
        )}
        <span className="shrink-0 font-medium text-foreground/80">{group.tools.length} 个工具调用</span>
        <span className="min-w-0 flex-1 truncate">
          {running ? (
            "运行中…"
          ) : (
            <>
              · {group.status === "all_ok" ? "全部成功" : `${group.errorCount} 个失败`}
              {group.totalDurationMs != null ? ` · 总耗时 ${fmtSeconds(group.totalDurationMs)}` : ""}
            </>
          )}
        </span>
        {group.errorCount > 0 && !running && (
          <span className="shrink-0 font-mono text-[11px] text-destructive/70">{group.errorCount}✗</span>
        )}
        {group.runningCount > 0 && (
          <span className="shrink-0 font-mono text-[11px] text-primary/80">{group.runningCount}…</span>
        )}
        <ChevronDown
          className={cnRotate(open)}
          size={14}
        />
      </button>
      {open && (
        <div className="mt-0.5 mb-1 ml-[7px] space-y-0.5 border-l-2 border-border pl-3">
          {group.tools.map((tool) => (
            <ToolCard
              key={tool.id}
              name={tool.name}
              args={tool.args}
              status={tool.status}
              output={tool.output}
              diff={tool.diff}
              diffStat={tool.diffStat}
              truncated={tool.truncated}
              defaultOpen={cardDefaultOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
});

function cnRotate(open: boolean): string {
  return open
    ? "shrink-0 opacity-100 rotate-180 transition text-muted-foreground"
    : "shrink-0 opacity-0 group-hover/tg:opacity-100 transition text-muted-foreground";
}
