"use strict";
/**
 * demo-crash：验证插件崩溃与主进程隔离 + 自动重启。
 * 收到宿主控制消息 "crash" 后，故意以非零码硬退出（模拟原生崩溃）。
 * 主进程 utilityProcess 不受影响；PluginHost 检测 exit → 通知 + 按预算自动重启。
 */
const { bootstrap } = require("../_pi-client.cjs");

bootstrap({
  onActivate(api) {
    api.notify({ title: "崩溃演示插件已就绪", body: "点「演示：插件崩溃」将使其自我崩溃并自动重启", kind: "info" });
    console.log("[crash] activate（等待 crash 控制消息）");
  },
  onControl(name, _args, api) {
    if (name !== "crash") return;
    api.notify({ title: "即将自我崩溃", kind: "warning" });
    console.log("[crash] 收到 crash 控制，50ms 后硬退出");
    setTimeout(() => {
      try {
        process.crash();
      } catch (_) {
        /* 某些环境无 crash() */
      }
      if (typeof process.abort === "function") process.abort();
      else process.exit(7);
    }, 50);
  },
});
