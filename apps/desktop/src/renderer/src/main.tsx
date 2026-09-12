import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./globals.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { requirePi } from "./lib/preload-api";
import { useConversationsStore } from "./stores/conversations-store";

/**
 * 渲染前的窗口装饰（圆角／磨砂／全屏联动）。
 *
 * 这段跑在 React 挂载**之前**，ErrorBoundary 接不住它——它抛错就是真·白屏
 * （连 ReactDOM 都没起来）。所以必须自己兜住：装饰失败只降级（少个圆角／磨砂），
 * 绝不能拦住主界面渲染。
 *
 * 注意 `onWinFullscreenChanged` 走 requirePi 而不是 `?.`：可选链在缺失时是空操作，
 * 会把「没接线」伪装成「已成功」（真机先例：`sessionsDelete?.()` ⇒ UI 说已删除、文件仍在盘上）。
 */
function bootstrapChrome(): void {
  const pi: typeof window.pi | undefined = window.pi;
  if (!pi) {
    console.error("[pi-wood] preload 未注入：窗口装饰已跳过。请完全退出应用后重新打开。");
    return;
  }
  const isMac = pi.platform === "darwin";
  try {
    if (isMac) document.documentElement.classList.add("mac-frameless");
    if (pi.glass) document.documentElement.classList.add("glass");
    if (isMac) {
      requirePi(pi.onWinFullscreenChanged, "onWinFullscreenChanged")((fs) =>
        document.documentElement.classList.toggle("mac-fs", fs),
      );
    }
  } catch (err) {
    console.error("[pi-wood] 窗口装饰初始化失败（不影响主界面渲染）", err);
  }
}

const container = document.getElementById("root");
if (!container) {
  // 同样在 React 之外：留一段纯 DOM 文案，避免一片无从诊断的白屏
  document.body.textContent = "[pi-wood] 找不到挂载点 #root：构建产物或 index.html 不完整，请重新构建。";
  throw new Error("#root not found");
}

bootstrapChrome();

// ErrorBoundary 是「同步抛错 ⇒ 白屏」这一类隐患的**唯一收敛点**：
// preload 缺函数、effect 顶层调用、render 期抛错（含 cleanup 相位）统统在此降级为可见面板，
// 因此不必逐个改上百个 `window.pi.X(...)` 调用点（口径见 ErrorBoundary.tsx 顶部注释）。
createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary scope="应用">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// 探针/自动化调试钩子：与左栏树行点击同一条 store 路径（setActiveConversation → markSwitchStart）。
// 首选路径仍是真实 DOM 点击（树行带 data-conversation-id）；临时项目不在左栏时（如 --ui-latency-probe
// 的 tmpdir 项目）由此钩子兜底。首屏度量段（切换起点→首帧）两者完全一致。
(window as unknown as Record<string, unknown>).__piwoodSwitchConversation = (id: string): void => {
  useConversationsStore.getState().switchTo(id);
};
