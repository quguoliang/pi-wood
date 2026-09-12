import React from "react";
import { cn } from "@/lib/utils";
import { describeError, formatErrorReport, recoveryHint } from "@/lib/error-report";

/**
 * 应用级错误边界：把「同步抛错逃进 React 导致整块界面白屏」收敛为**可见的错误面板**。
 *
 * 为什么需要它（2026-09-12 真机白屏事故的根因）：
 * 渲染层直接调 `window.pi.X(...)`，当 preload 没有这个函数时抛的是**同步 TypeError**，
 * 它发生在 promise 构造之前 ⇒ 后面的 `.catch()` 收不到；若调用点位于 effect／render 顶层，
 * 异常会沿组件树冒泡，而 React 18 在**没有边界**时的处理是**卸载整棵树**=白屏。
 *
 * 实测口径（离线工装 8/8，见 apps/desktop/docs/proofs 归档）：
 * 无边界时 `passive effect`／`layout effect`／`render`／**effect cleanup（切会话卸载面板）**
 * 四种相位同步抛错一律把 `#root` 清空；有边界时四种**全部**被 `componentDidCatch` 接住。
 * ⇒ 所以「收敛调用点」这件事只需要**一处**边界，不必去改上百个调用点。
 *
 * 三条实现约束：
 * 1. **判据必须是独立布尔量**：`throw undefined` 是合法语句，用 `error != null` 判定会漏掉它。
 * 2. **fallback 的依赖面必须最小**：它自己渲染失败时没有更外层边界接得住（错误处理器变成
 *    新错误源 = 仍然白屏）。因此这里只用原生 `<button>` 与 `cn`，不引 Button／Radix／store。
 * 3. **「重试」要真重挂子树**：仅把 `hasError` 置回 false 会复用已崩坏的子树状态，
 *    用自增的 `attempt` 作 key 强制重新挂载。
 */

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** 出错区域名，显示在标题与复制报告中（如「右侧面板」「应用」） */
  scope: string;
  /** 紧凑版：用于窄栏（右栏） */
  compact?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: unknown;
  /** 每次「重试」自增，作为子树 key 强制重新挂载 */
  attempt: number;
  copied: boolean;
  /** 出错时固化的报告文本（时间戳与用户看到／复制到的内容保持一致） */
  reportText: string;
}

const BUTTON_CLASS =
  "inline-flex h-7 shrink-0 items-center rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50";

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: undefined,
    attempt: 0,
    copied: false,
    reportText: "",
  };

  public static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { hasError: true, error, copied: false };
  }

  public componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    // 契约缺失时 react 自身也会打一条 console.error；这里补上「哪块区域 + 组件栈」，
    // 便于从日志直接定位（真机排障时控制台往往只剩这一条线索）。
    console.error(`[pi-wood] ${this.props.scope} 渲染失败：`, error, info.componentStack);
    this.setState({ reportText: formatErrorReport(error, this.props.scope, new Date(), window.pi) });
  }

  private readonly reportText = (): string =>
    this.state.reportText.length > 0
      ? this.state.reportText
      : formatErrorReport(this.state.error, this.props.scope, new Date(), window.pi);

  private readonly handleRetry = (): void => {
    this.setState((prev) => ({
      hasError: false,
      error: undefined,
      copied: false,
      reportText: "",
      attempt: prev.attempt + 1,
    }));
  };

  private readonly handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(this.reportText());
      this.setState({ copied: true });
    } catch {
      // clipboard 在部分上下文不可用：保持原样，用户仍可在「错误详情」里手动选中复制
      this.setState({ copied: false });
    }
  };

  public render(): React.ReactNode {
    if (!this.state.hasError) {
      // key 变化 ⇒ 子树重新挂载（「重试」的真正实现）
      return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
    }

    const report = describeError(this.state.error);
    const hint = recoveryHint(this.state.error, window.pi);

    return (
      <div
        role="alert"
        className={cn(
          "h-full min-h-0 overflow-auto text-xs",
          this.props.compact ? "bg-card p-4" : "grid place-items-center bg-background p-8",
        )}
      >
        <div
          className={cn(
            "w-full space-y-2",
            this.props.compact ? "max-w-none" : "max-w-[560px] rounded-lg border border-border bg-card p-5 shadow-sm",
          )}
        >
          <div className="text-sm font-medium text-destructive">{this.props.scope}出错了</div>
          <div className="break-words font-mono text-[11px] leading-relaxed text-foreground/90">
            {report.name}: {report.message}
          </div>
          <div className="leading-relaxed text-muted-foreground">{hint}</div>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button type="button" className={BUTTON_CLASS} onClick={this.handleRetry}>
              重试
            </button>
            <button type="button" className={BUTTON_CLASS} onClick={this.handleCopy}>
              {this.state.copied ? "已复制" : "复制错误信息"}
            </button>
          </div>
          <details className="text-muted-foreground">
            <summary className="cursor-pointer select-none hover:text-foreground">错误详情</summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
              {this.reportText()}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
