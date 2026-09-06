import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./globals.css";
import { useConversationsStore } from "./stores/conversations-store";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

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
