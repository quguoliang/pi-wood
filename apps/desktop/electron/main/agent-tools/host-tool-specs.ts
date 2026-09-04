import { Type } from "typebox";

/**
 * T8.1：宿主工具「声明」与「实现」分离。
 * 本模块刻意不依赖 electron（只 import typebox），因为引擎已搬进 utilityProcess 子进程，
 * 子进程需要按名注册同名代理工具（execute 经 RPC 转发回主进程），故必须能打包进子进程。
 * 真正的 execute 实现仍留在主进程的 browser-tools.ts / memory-tools.ts（要碰 BrowserView/WebContents 与 memory store）。
 */
export interface CustomToolSpec {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
}

/**
 * T2.4：浏览器能力以 agent 工具暴露（"面板能力即 agent 工具"，方案 §10.1）。
 * 形状 = Pi ToolDefinition（TypeBox 参数），经 SdkAdapter customTools 注册。
 * 高风险动作（登录/支付类）由审批门扩展拦截（§10.3）。
 */
export const BROWSER_TOOL_SPECS: CustomToolSpec[] = [
  {
    name: "browser_navigate",
    label: "浏览器导航",
    description: "打开内置浏览器并访问指定 URL，返回页面标题",
    parameters: Type.Object({ url: Type.String({ description: "完整 URL，含 https://" }) }),
  },
  {
    name: "browser_read_text",
    label: "读取页面文本",
    description: "读取当前浏览器页面的可见文本（前 4000 字符）",
    parameters: Type.Object({}),
  },
  {
    name: "browser_click",
    label: "点击页面元素",
    description: "在当前页面点击元素。selector 为 CSS 选择器或 text=按钮文字",
    parameters: Type.Object({ selector: Type.String({ description: "CSS 选择器或 text=文字" }) }),
  },
  {
    name: "browser_fill",
    label: "填写输入框",
    description: "在页面输入框中填写文字。selector 为 CSS 选择器",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS 选择器" }),
      text: Type.String({ description: "要填写的文字" }),
    }),
  },
  {
    name: "browser_screenshot",
    label: "页面截图",
    description: "对当前浏览器页面截图，截图会显示在右栏浏览器面板",
    parameters: Type.Object({}),
  },
];

/**
 * T7.10 Agent Memory 工具声明。
 * 跨会话留存值得记住的信息；agent 保存的默认「待确认」(reviewed:false)，用户在设置页确认后转正。
 * scope：global 跨项目、project 仅当前项目（由活动项目目录推导，agent 不能指定项目 id）。
 */
// 注意：工具名必须匹配 ^[a-zA-Z0-9_-]+$——OpenAI 兼容端点（DeepSeek 等）会拒绝含「.」的名字
// （400 Invalid tools[i].function.name），导致整轮请求失败、助手回复为空。故用下划线而非 memory.save 式点号。
export const MEMORY_TOOL_SPECS: CustomToolSpec[] = [
  {
    name: "memory_save",
    label: "保存记忆",
    description:
      "跨会话记住一件事（偏好/事实/参考）。下次会话仍可见。scope=global 跨所有项目、project 仅当前项目（默认 global）。" +
      "保存的内容默认待用户确认；确认后才会视为可靠长期记忆。已有同名同 scope 的条目会更新。",
    parameters: Type.Object({
      scope: Type.Optional(Type.Union([Type.Literal("global"), Type.Literal("project")], { description: "global|project，默认 global" })),
      type: Type.Optional(Type.Union([Type.Literal("fact"), Type.Literal("preference"), Type.Literal("reference")], { description: "默认 fact" })),
      title: Type.String({ description: "简短标题" }),
      body: Type.String({ description: "要记住的内容" }),
    }),
  },
  {
    name: "memory_list",
    label: "列出记忆",
    description: "列出已保存的记忆（全局 + 当前项目），含 id 与是否已确认。未确认条目谨慎参考。",
    parameters: Type.Object({}),
  },
  {
    name: "memory_read",
    label: "读取记忆",
    description: "按 id 读取一条记忆的完整内容。",
    parameters: Type.Object({ id: Type.String({ description: "memory_list 返回的 id" }) }),
  },
  {
    name: "memory_delete",
    label: "删除记忆",
    description: "按 id 删除一条记忆。",
    parameters: Type.Object({ id: Type.String({ description: "要删除的记忆 id" }) }),
  },
];

/** 子进程注册代理工具时用这一份即可（浏览器在前、记忆在后，与主进程注入顺序一致）。 */
export const ALL_HOST_TOOL_SPECS: CustomToolSpec[] = [...BROWSER_TOOL_SPECS, ...MEMORY_TOOL_SPECS];
