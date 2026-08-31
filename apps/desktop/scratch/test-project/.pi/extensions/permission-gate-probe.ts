// T0.4 探针：验证 pi.on("tool_call") 拦截能力（审批门的机制基础）
// 用环境变量 PI_PROBE_BLOCK_BASH=1 开启，避免污染其他探针场景
export default function (pi) {
  pi.on("tool_call", async (event) => {
    if (process.env.PI_PROBE_BLOCK_BASH !== "1") return;
    if (event.toolName === "bash") {
      console.log("[permission-gate-probe] blocking bash call");
      return { block: true, reason: "Denied by T0.4 probe policy (审批门测试)" };
    }
    return;
  });
}
