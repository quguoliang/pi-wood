import { cn } from "@/lib/utils";

/**
 * 设置详情区的两个排版原语（参考 Codex 设置页）：
 * - SettingCard：一块圆角描边卡片，行间用分隔线；
 * - SettingRow：一行「标题+描述 | 右侧控件」，控件垂直居中。
 * 复用现有令牌（border-border/60、bg-card），不新增颜色。
 */
export function SettingCard({ className, children }: { className?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className={cn("divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60 bg-card/50", className)}>
      {children}
    </section>
  );
}

export function SettingRow({
  title,
  description,
  className,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={cn("flex items-center justify-between gap-6 px-5 py-3.5", className)}>
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {description && <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/** 大项内的分组小标题（如「默认模型 / 辅助小模型」），非卡片行。 */
export function SettingGroupLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{children}</h3>
      {action}
    </div>
  );
}
