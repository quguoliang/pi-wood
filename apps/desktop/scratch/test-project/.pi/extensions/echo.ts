// T0.3 示例扩展：验证 DefaultResourceLoader 发现 + registerTool + ctx.ui 桥接
import { Type } from "typebox";

export default function (pi) {
  pi.registerTool({
    name: "echo_greeting",
    label: "Echo Greeting",
    description: "Echo back a greeting message. Use this when the user asks to send a greeting.",
    parameters: Type.Object({
      text: Type.String({ description: "The greeting text to echo" }),
    }),
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      // ctx.ui 桌面桥接验证点：SDK/RPC 模式下 notify 的实际行为待观察
      try {
        ctx.ui?.notify?.(`[echo] ${params.text}`, "info");
        console.log("[extension-echo] ctx.ui.notify called OK");
      } catch (err) {
        console.log("[extension-echo] ctx.ui.notify failed:", String(err));
      }
      return {
        content: [{ type: "text", text: `Echo: ${params.text}` }],
        details: {},
      };
    },
  });
}
