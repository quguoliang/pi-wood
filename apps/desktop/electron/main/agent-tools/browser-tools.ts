import {
  browserClick,
  browserFill,
  browserNavigate,
  browserScreenshot,
  browserText,
} from "../workbench/browser-service";
import { BROWSER_TOOL_SPECS } from "./host-tool-specs";
import type { CustomToolSpec } from "./host-tool-specs";

/**
 * T2.4：浏览器能力以 agent 工具暴露（"面板能力即 agent 工具"，方案 §10.1）。
 * 形状 = Pi ToolDefinition（TypeBox 参数），经 SdkAdapter customTools 注册。
 * 高风险动作（登录/支付类）由审批门扩展拦截（§10.3）。
 * T8.1：声明（name/label/description/parameters）搬到 host-tool-specs.ts（electron-free，可打包进引擎子进程），
 * 本文件只留 execute——它要碰 BrowserView/WebContents，只能活在主进程。
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

/** 与 BROWSER_TOOL_SPECS 的 name 一一对应；这里漏写一个实现就是编译期类型错误（不用运行时兜底掩盖 undefined）。 */
type BrowserToolName =
  | "browser_navigate"
  | "browser_read_text"
  | "browser_click"
  | "browser_fill"
  | "browser_screenshot";

const EXECUTE = {
  browser_navigate: async (_id, params) => {
    await browserNavigate(String(params.url));
    return { content: [{ type: "text", text: `已导航到 ${params.url}` }], details: {} };
  },
  browser_read_text: async () => {
    const text = await browserText();
    return { content: [{ type: "text", text: text || "(空白页面)" }], details: {} };
  },
  browser_click: async (_id, params) => {
    await browserClick(String(params.selector));
    return { content: [{ type: "text", text: `已点击 ${params.selector}` }], details: {} };
  },
  browser_fill: async (_id, params) => {
    await browserFill(String(params.selector), String(params.text));
    return { content: [{ type: "text", text: `已填写 ${params.selector}` }], details: {} };
  },
  browser_screenshot: async () => {
    const screenshot = await browserScreenshot();
    return {
      content: [
        { type: "text", text: "截图完成，见浏览器面板" },
        { type: "image", data: screenshot, mimeType: "image/png" },
      ],
      details: {},
    };
  },
} satisfies Record<BrowserToolName, CustomToolDef["execute"]>;

export function browserCustomTools(): CustomToolDef[] {
  // CustomToolSpec.name 是 string（被接口拓宽），故需窄化回 BrowserToolName；两者由上面的 satisfies 保证同集。
  return BROWSER_TOOL_SPECS.map((s: CustomToolSpec) => ({ ...s, execute: EXECUTE[s.name as BrowserToolName] }));
}
