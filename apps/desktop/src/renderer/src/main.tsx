import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./globals.css";
import { useConversationsStore } from "./stores/conversations-store";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

// macOS 透明窗：body 需全透明、#root 自绘圆角（见 globals.css .mac-frameless）；
// 原生全屏时去掉圆角（透明圆角在全屏下露成白角）
if (window.pi.platform === "darwin") {
  document.documentElement.classList.add("mac-frameless");
  window.pi.onWinFullscreenChanged((fs) => document.documentElement.classList.toggle("mac-fs", fs));
}

// 磨砂玻璃生效（主进程已按开关 + 平台能力判定）：挂 html.glass → chrome 令牌转透明，透出系统材质
if (window.pi.glass) {
  document.documentElement.classList.add("glass");
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// 探针/自动化调试钩子：与左栏树行点击同一条 store 路径（setActiveConversation → markSwitchStart）。
// 首选路径仍是真实 DOM 点击（树行带 data-conversation-id）；临时项目不在左栏时（如 --ui-latency-probe
// 的 tmpdir 项目）由此钩子兜底。首屏度量段（切换起点→首帧）两者完全一致。
(window as unknown as Record<string, unknown>).__piwoodSwitchConversation = (id: string): void => {
  useConversationsStore.getState().switchTo(id);
};
