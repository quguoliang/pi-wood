import { Type } from "typebox";
import {
  browserClick,
  browserFill,
  browserNavigate,
  browserScreenshot,
  browserText,
} from "../workbench/browser-service";

/**
 * T2.4：浏览器能力以 agent 工具暴露（"面板能力即 agent 工具"，方案 §10.1）。
 * 形状 = Pi ToolDefinition（TypeBox 参数），经 SdkAdapter customTools 注册。
 * 高风险动作（登录/支付类）由审批门扩展拦截（§10.3）。
 */
export interface CustomToolDef {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: unknown,
    onUpdate: unknown,
    ctx: unknown,
  ): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; details: object }>;
}

export function browserCustomTools(): CustomToolDef[] {
  return [
    {
      name: "browser_navigate",
      label: "浏览器导航",
      description: "打开内置浏览器并访问指定 URL，返回页面标题",
      parameters: Type.Object({ url: Type.String({ description: "完整 URL，含 https://" }) }),
      async execute(_id, params) {
        await browserNavigate(String(params.url));
        return { content: [{ type: "text", text: `已导航到 ${params.url}` }], details: {} };
      },
    },
    {
      name: "browser_read_text",
      label: "读取页面文本",
      description: "读取当前浏览器页面的可见文本（前 4000 字符）",
      parameters: Type.Object({}),
      async execute() {
        const text = await browserText();
        return { content: [{ type: "text", text: text || "(空白页面)" }], details: {} };
      },
    },
    {
      name: "browser_click",
      label: "点击页面元素",
      description: "在当前页面点击元素。selector 为 CSS 选择器或 text=按钮文字",
      parameters: Type.Object({ selector: Type.String({ description: "CSS 选择器或 text=文字" }) }),
      async execute(_id, params) {
        await browserClick(String(params.selector));
        return { content: [{ type: "text", text: `已点击 ${params.selector}` }], details: {} };
      },
    },
    {
      name: "browser_fill",
      label: "填写输入框",
      description: "在页面输入框中填写文字。selector 为 CSS 选择器",
      parameters: Type.Object({
        selector: Type.String({ description: "CSS 选择器" }),
        text: Type.String({ description: "要填写的文字" }),
      }),
      async execute(_id, params) {
        await browserFill(String(params.selector), String(params.text));
        return { content: [{ type: "text", text: `已填写 ${params.selector}` }], details: {} };
      },
    },
    {
      name: "browser_screenshot",
      label: "页面截图",
      description: "对当前浏览器页面截图，截图会显示在右栏浏览器面板",
      parameters: Type.Object({}),
      async execute() {
        const screenshot = await browserScreenshot();
        return {
          content: [
            { type: "text", text: "截图完成，见浏览器面板" },
            { type: "image", data: screenshot, mimeType: "image/png" },
          ],
          details: {},
        };
      },
    },
  ];
}
