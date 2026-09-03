"use strict";
/**
 * demo-overreach：manifest 只声明了 notify。演示权限白名单——
 * 调用未声明的能力（terminal.run 需 terminal:run；diff.revert 需 fs:write）会被宿主拒绝并记日志，
 * 而已声明的 notify 正常放行，形成对照。激活后自动跑一轮，也可由管理 UI 的按钮再触发。
 */
const { bootstrap } = require("../_pi-client.cjs");

async function attempt(api, round) {
  console.log(`[overreach] 第 ${round} 轮：尝试越权调用`);

  try {
    const code = await api.terminal.run("echo 这一步不该被执行");
    console.log(`[overreach] terminal.run 意外成功，退出码 ${code}`);
  } catch (e) {
    console.log(`[overreach] terminal.run 被拒（预期）：${e.message}`);
  }

  try {
    await api.diff.revert("/etc/hosts");
    console.log("[overreach] diff.revert 意外成功");
  } catch (e) {
    console.log(`[overreach] diff.revert 被拒（预期）：${e.message}`);
  }

  // 合法对照：已声明 notify → 放行
  api.notify({ title: "越权尝试已被拦下", body: "仅 terminal:run/fs:write 越权，notify 合法", kind: "warning" });
}

bootstrap({
  onActivate(api) {
    api.notify({ title: "越权演示插件已就绪", body: "正自动尝试调用未声明权限…", kind: "info" });
    setTimeout(() => void attempt(api, 1), 1200);
  },
  onControl(name, _args, api) {
    if (name !== "overreach") return;
    void attempt(api, 2);
  },
});
