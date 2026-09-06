"use strict";
/**
 * demo-kitchen：展示 §5.8 桌面 API 的非敏感面（不会弹审批/确认）。
 * 收到宿主控制消息 "kitchen"（管理 UI「演示：API 全能力」按钮触发）后才：
 * notify 欢迎、注册文本面板、放状态栏项、设窗口进度、订阅+发布总线、读权限清单、请求编辑器打开 README。
 * ⚠ 不再「激活即自燃」——避免每次启动把一堆 API 调用/越权尝试写进活动日志。
 */
const { bootstrap } = require("../_pi-client.cjs");

function showcase(api) {
  api.notify({ title: "厨房插件演示", body: "注册面板/状态栏/进度，试总线与 getPermissions", kind: "success" });
  console.log("[kitchen] showcase");

  api.panels
    .register({ id: "kitchen.notes", title: "示例面板", component: "text", visible: true })
    .then(() => console.log("[kitchen] panel registered"))
    .catch((e) => console.log("[kitchen] panel denied:", e.message));

  api.statusbar
    .setItem("kitchen", { id: "kitchen", text: "kitchen ok", kind: "info" })
    .then(() => console.log("[kitchen] statusbar item set"))
    .catch((e) => console.log("[kitchen] statusbar denied:", e.message));

  api.window.setProgress(0.5).catch(() => {});
  setTimeout(() => api.window.setProgress(0).catch(() => {}), 8000);

  const off = api.bus.subscribe("kitchen.echo", (payload) => {
    console.log("[kitchen] bus echo:", JSON.stringify(payload));
  });
  api.bus.publish("kitchen.echo", { hello: "world" }).catch((e) => console.log("[kitchen] bus publish denied:", e.message));
  setTimeout(off, 30000);

  api
    .getPermissions()
    .then((perms) => console.log("[kitchen] declared permissions:", JSON.stringify(perms)))
    .catch((e) => console.log("[kitchen] getPermissions error:", e.message));

  // 越权演示（反面）：kitchen 未声明 terminal:run，尝试调用应被拒
  api.terminal
    .run("echo should-be-denied")
    .then((code) => console.log("[kitchen] terminal unexpectedly ran, code", code))
    .catch((e) => console.log("[kitchen] terminal denied as expected:", e.message));

  api.editor.openFile("README.md").catch((e) => console.log("[kitchen] editor denied:", e.message));
}

bootstrap({
  onActivate(api) {
    api.notify({ title: "厨房演示插件已就绪", body: "点「演示：API 全能力」查看 §5.8 桌面 API", kind: "info" });
  },
  onControl(name, _args, api) {
    if (name !== "kitchen") return;
    showcase(api);
  },
});
