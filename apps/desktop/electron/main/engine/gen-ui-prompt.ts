import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * T11.1 生成式 UI（Generative UI）——内置系统提示词与开关判定。
 *
 * 设计口径（三条硬约束）：
 * 1. **不落盘、不改 Pi 配置**：本模块只在资源加载时把一段内置指令追加到系统提示词末尾
 *    （经 SDK 的 `appendSystemPromptOverride`），不写 `APPEND_SYSTEM.md`，
 *    因此不会污染用户的 Pi agentDir，也不会与用户自己的 APPEND_SYSTEM.md 打架。
 * 2. **electron-free**：本文件被引擎子进程（utilityProcess）静态 import，
 *    绝不能引入 `electron`（`settings-service.ts` 引了 ipcMain/nativeTheme，子进程里取不到）。
 * 3. **开关缺失即关闭**：UNKNOWN/缺字段一律返回 false——生成式 UI 会让模型产出**可执行 HTML**，
 *    默认必须是关的，任何「读不到就打开」的写法都是安全缺陷。
 */

/** 围栏代码块的语言标记：模型用 ```genui 包裹自包含 HTML */
export const GEN_UI_FENCE = "genui";

/** 渲染层解析时同样接受这些别名（模型偶尔会写成 genui-html / genui_html） */
export const GEN_UI_FENCE_ALIASES: readonly string[] = [GEN_UI_FENCE, "genui-html", "genui_html"];

/**
 * 内置指令。参考 eli5（https://github.com/dreambigou/eli5）的「先给一句话结论、
 * 按受众调节解释粒度」范式，但 eli5 本身只是**解释风格**技能，不含任何生成式 UI 契约，
 * 故「围栏格式 + 类库 + 沙箱边界」三段是本项目自行定义的硬契约，模型必须逐条遵守。
 *
 * 2026-09-11 第二版（真机看效果后返工）：第一版只给了「令牌清单 + 禁令」，
 * 模型实际产出在深色底上画出浅色块、标题对比度极低、并用 `height:100vh` 把自动高度卡死。
 * 结论：**禁令压不住模型的默认审美，必须给可抄的成品**。第二版改成「类库优先 + 三段可复制片段」，
 * 并在沙箱侧加了基线 CSS 与颜色/视口单位消毒作为兜底（见 ui-kit 的 gen-ui-core.ts）。
 */
export const GEN_UI_INSTRUCTION = `## 生成式 UI（Generative UI）

当**图形比纯文字更清楚**时，你可以在回复正文里插入一段生成式 UI。除此之外一律用普通 Markdown。

### 输出格式（硬契约）

UI 必须放在独立的围栏代码块里，语言标记固定为 \`${GEN_UI_FENCE}\`，内容是**自包含 HTML 片段**：

\`\`\`${GEN_UI_FENCE}
<div class="pk-wrap">
  <div class="pk-title">标题</div>
  <div class="pk-card">内容</div>
</div>
\`\`\`

### 视觉规则（最重要，违反即丑）

1. **一律用下面这套类，不要自己发明样式。** 这是宿主唯一调好的视觉层，深/浅色主题会自动跟随：

   \`pk-wrap\`（根容器，必加）、\`pk-title\`（标题）、\`pk-sub\`（次要说明）、\`pk-card\`（卡片）、
   \`pk-grid\`（自适应栅格，放多张卡）、\`pk-row\`（横排）、\`pk-spread\`（两端对齐一行）、
   \`pk-badge\` / \`pk-badge-primary\` / \`pk-badge-success\` / \`pk-badge-warning\` / \`pk-badge-danger\`（小标签）、
   \`pk-btn\` / \`pk-btn-primary\`（按钮）、\`pk-step\` + \`pk-num\`（编号步骤）、\`pk-flow\`（居中箭头行，用 ▼）、
   \`pk-kv\`（键值行）、\`pk-ink\`（强调正文）、\`pk-code\`（行内代码）、\`pk-hint\`（小字提示）。

2. **禁止写颜色、背景色、字号、字体、阴影、渐变。** 不要出现 \`#fff\` / \`white\` / \`color:...\` / \`background:...\` /
   \`font-size:...\` 这类声明（写了也会被宿主改写，只会白费力气）。颜色一律靠上面的类。
   **不要铺整块底色**——宿主卡片已经提供了背景与描边。
3. **禁止写死高度。** 不许出现 \`height\` / \`min-height\` / \`100vh\` / \`vh\`；容器宽度写 \`width:100%\`。
   高度由宿主自动测量，写死会把内容截断。
4. 间距靠 \`pk-grid\` / \`pk-wrap\` 的 \`gap\`；需要额外留白时只用 \`margin-top\` 的 4 / 8 / 12 这类小值。
5. 内容要短：卡片标题 ≤12 字、正文 ≤2 行、选项 ≤4 个、整块不超过一屏。
6. 每次回复**最多 1 段** \`${GEN_UI_FENCE}\` 块；块外仍要先给文字结论。

### 可复制片段（照抄结构，替换文案）

对比 / 选项卡：
\`\`\`${GEN_UI_FENCE}
<div class="pk-wrap">
  <div class="pk-title">三种方案对比</div>
  <div class="pk-grid">
    <div class="pk-card">
      <div class="pk-spread"><span class="pk-ink">方案 A</span><span class="pk-badge-primary">推荐</span></div>
      <div class="pk-sub">改配置即可，无需改代码</div>
      <div class="pk-hint">成本 低 · 风险 低</div>
    </div>
    <div class="pk-card">
      <div class="pk-spread"><span class="pk-ink">方案 B</span><span class="pk-badge-warning">有代价</span></div>
      <div class="pk-sub">需重启服务</div>
      <div class="pk-hint">成本 中 · 风险 中</div>
    </div>
  </div>
</div>
\`\`\`

步骤流：
\`\`\`${GEN_UI_FENCE}
<div class="pk-wrap">
  <div class="pk-step"><span class="pk-num">1</span><div><div class="pk-ink">收集日志</div><div class="pk-sub">tail -f 服务输出</div></div></div>
  <div class="pk-flow">▼</div>
  <div class="pk-step"><span class="pk-num">2</span><div><div class="pk-ink">定位异常</div><div class="pk-sub">按 traceId 归并</div></div></div>
</div>
\`\`\`

可点击继续（点按钮＝把这句话发回对话）：
\`\`\`${GEN_UI_FENCE}
<div class="pk-wrap">
  <div class="pk-sub">选一个方向我继续展开</div>
  <div class="pk-row">
    <button class="pk-btn pk-btn-primary" data-piwood-prompt="按方案 A 继续，给出具体配置">方案 A</button>
    <button class="pk-btn" data-piwood-prompt="按方案 B 继续，给出改造步骤">方案 B</button>
  </div>
</div>
\`\`\`

### 边界

7. 交互只允许一种：\`piwood.sendPrompt('…')\` 或给元素加 \`data-piwood-prompt="…"\`（点击即发送），
   用途是「选一个继续」。禁止网络请求、本地存储、导航跳转、弹窗。
8. UI 运行在沙箱 iframe 内，**无法访问宿主页面**，不要试图读写宿主 DOM 或全局变量。
9. 该能力由用户设置开关控制；若图形无助于表达，就正常回答，不要为了用而用。`;


/** 纯函数：设置对象 → 是否开启（缺字段/类型不符一律 false） */
export function isGenUiEnabledFromSettings(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") return false;
  const ui = (raw as { ui?: unknown }).ui;
  if (ui === null || typeof ui !== "object") return false;
  return (ui as { generativeUi?: unknown }).generativeUi === true;
}

/** 纯函数：开关 → 要追加的系统提示词段（关闭时返回空数组，绝不用空字符串占位） */
export function gateGenUiPrompt(enabled: boolean): string[] {
  return enabled ? [GEN_UI_INSTRUCTION] : [];
}

// 与 settings-service.ts 的 APP_DATA_DIR 保持同一表达式（此处刻意不 import 它——那会把 electron 拖进子进程）
const SETTINGS_PATH = join(process.env["USERPROFILE"] ?? process.env["HOME"] ?? ".", ".pi-wood", "settings.json");

let cache: { mtimeMs: number; size: number; enabled: boolean } | undefined;

/**
 * 读取 `~/.pi-wood/settings.json` 判定开关（按 mtime+size 缓存，避免每次资源加载都读盘）。
 * 文件不存在/损坏 → false（保守关闭）。
 */
export function isGenUiEnabled(): boolean {
  try {
    if (!existsSync(SETTINGS_PATH)) return false;
    const st = statSync(SETTINGS_PATH);
    if (cache && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.enabled;
    const enabled = isGenUiEnabledFromSettings(JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")));
    cache = { mtimeMs: st.mtimeMs, size: st.size, enabled };
    return enabled;
  } catch {
    return false;
  }
}

/**
 * 传给 SdkAdapter 的 provider：**每次资源加载/reload 都会被调用一次**，
 * 因此用户切换开关后只需触发一次引擎 reload（`engine:reload`），
 * SDK 会重建系统提示词，无需重启对话。
 */
export function readGenUiAppendPrompt(): string[] {
  return gateGenUiPrompt(isGenUiEnabled());
}
