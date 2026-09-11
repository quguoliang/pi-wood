import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GEN_UI_BASE_CSS,
  GEN_UI_DESIGN_CLASSES,
  GEN_UI_LANGUAGES,
  GEN_UI_SANDBOX_ATTR,
  buildGenUiSrcDoc,
  genUiBaseStyles,
  isGenUiLanguage,
  neutralizeHardcodedColors,
  neutralizeViewportUnits,
  sanitizeGenUiHtml,
} from "./gen-ui-core.ts";

/* ---------------- 围栏识别 ---------------- */

test("isGenUiLanguage：认 genui 与两个常见别名（含大小写/空白容错）", () => {
  assert.equal(isGenUiLanguage("genui"), true);
  assert.equal(isGenUiLanguage("GENUI"), true);
  assert.equal(isGenUiLanguage(" GenUi "), true);
  assert.equal(isGenUiLanguage("genui-html"), true);
  assert.equal(isGenUiLanguage("genui_html"), true);
});

test("isGenUiLanguage：不得把普通语言误判成生成式 UI", () => {
  for (const lang of ["html", "xml", "javascript", "tsx", "markdown", "gen", "plaintext", ""]) {
    assert.equal(isGenUiLanguage(lang), false, `${lang} 不应被识别为 genui`);
  }
  assert.equal(isGenUiLanguage(undefined), false);
});

test("GEN_UI_LANGUAGES 以 genui 为主标记（与引擎侧 GEN_UI_FENCE 对齐）", () => {
  assert.equal(GEN_UI_LANGUAGES[0], "genui");
});

/* ---------------- 沙箱属性：这是安全红线 ---------------- */

test("沙箱只给 allow-scripts，绝不放开 allow-same-origin", () => {
  assert.equal(GEN_UI_SANDBOX_ATTR, "allow-scripts");
  assert.ok(!GEN_UI_SANDBOX_ATTR.includes("allow-same-origin"));
  assert.ok(!GEN_UI_SANDBOX_ATTR.includes("allow-top-navigation"));
  assert.ok(!GEN_UI_SANDBOX_ATTR.includes("allow-popups"));
  assert.ok(!GEN_UI_SANDBOX_ATTR.includes("allow-modals"));
});

/* ---------------- 视觉基线：契约锚点（与提示词侧同一份名单） ---------------- */

/** 核心类名单：提示词（gen-ui-prompt.ts）与基线 CSS 各钉一次，任一侧改名即红 */
const CORE_CLASSES = [
  "pk-wrap", "pk-title", "pk-sub", "pk-card", "pk-grid", "pk-row", "pk-spread",
  "pk-badge", "pk-btn", "pk-btn-primary", "pk-step", "pk-num", "pk-flow",
  "pk-kv", "pk-ink", "pk-code", "pk-hint",
];

test("基线 CSS 定义了核心类（每个都是一条 .pk-x 规则）", () => {
  for (const cls of CORE_CLASSES) {
    assert.ok(GEN_UI_BASE_CSS.includes(`.${cls}{`) || GEN_UI_BASE_CSS.includes(`.${cls}:`), `基线缺失 .${cls}`);
  }
});

test("GEN_UI_DESIGN_CLASSES 与基线 CSS 自洽（名单里的每条都必须有定义）", () => {
  for (const cls of GEN_UI_DESIGN_CLASSES) {
    assert.ok(GEN_UI_BASE_CSS.includes(`.${cls}{`) || GEN_UI_BASE_CSS.includes(`.${cls}:`), `名单有 .${cls} 但基线没定义`);
  }
});

test("基线把「破坏高度测量」的属性用 !important 钉死", () => {
  // 这是自动高度的命门：模型写 body{height:100%} 或包装层 100vh 时，测量会恒等于视口高度
  assert.ok(/html,body\{[^}]*height:auto\s*!important/.test(GEN_UI_BASE_CSS));
  assert.ok(/html,body\{[^}]*min-height:0\s*!important/.test(GEN_UI_BASE_CSS));
  assert.ok(/html,body\{[^}]*max-height:none\s*!important/.test(GEN_UI_BASE_CSS));
  assert.ok(/html,body\{[^}]*background:transparent\s*!important/.test(GEN_UI_BASE_CSS));
});

test("基线不得自己引入 vh 单位（否则又变成自指高度）", () => {
  assert.equal(/(?<![\w-])\d+(\.\d+)?(vh|dvh|svh|lvh)\b/.test(GEN_UI_BASE_CSS), false);
});

test("基线只在令牌上取色，不硬编码 hex 颜色", () => {
  const hex = GEN_UI_BASE_CSS.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.deepEqual(hex, [], `基线出现硬编码颜色：${hex.join(", ")}`);
});

/* ---------------- 视口单位消毒 ---------------- */

test("neutralizeViewportUnits：100 档归 100%，小比例保持原意", () => {
  assert.equal(neutralizeViewportUnits("body{height:100vh}"), "body{height:100%}");
  assert.equal(neutralizeViewportUnits("div{min-height:100dvh}"), "div{min-height:100%}");
  assert.equal(neutralizeViewportUnits("div{width:100vw}"), "div{width:100%}");
  assert.equal(neutralizeViewportUnits("div{height:40vh}"), "div{height:40vh}");
  assert.equal(neutralizeViewportUnits("span{font-size:2vw}"), "span{font-size:2vw}");
  // 不给数值加单位后缀的情况不应误伤
  assert.equal(neutralizeViewportUnits("a{--x:100vh}"), "a{--x:100%}");
});

/* ---------------- 硬编码颜色消毒 ---------------- */

test("neutralizeHardcodedColors：浅色背景 → 卡片色（深色主题上画白块的元凶）", () => {
  assert.equal(neutralizeHardcodedColors("div{background:#fff}"), "div{background:var(--color-card)}");
  assert.equal(neutralizeHardcodedColors('div style="background-color: #f5f5f5"'), 'div style="background-color:var(--color-card)"');
  assert.equal(neutralizeHardcodedColors("div{background:white}"), "div{background:var(--color-card)}");
  assert.equal(neutralizeHardcodedColors("div{background:rgb(250, 250, 250)}"), "div{background:var(--color-card)}");
});

test("neutralizeHardcodedColors：深色背景 → 弱化色，深/浅色文字 → 前景色", () => {
  assert.equal(neutralizeHardcodedColors("div{background:#000}"), "div{background:var(--color-muted)}");
  assert.equal(neutralizeHardcodedColors("div{color:#000}"), "div{color:var(--color-foreground)}");
  assert.equal(neutralizeHardcodedColors("div{color:#fff}"), "div{color:var(--color-foreground)}");
  assert.equal(neutralizeHardcodedColors("span{color:#888}"), "span{color:var(--color-muted-foreground)}");
});

test("neutralizeHardcodedColors：描边色 → 边框令牌（含 border 简写）", () => {
  assert.equal(neutralizeHardcodedColors("div{border:1px solid #e5e5e5}"), "div{border:1px solid var(--color-border)}");
  assert.equal(neutralizeHardcodedColors("div{border-color:#ddd}"), "div{border-color:var(--color-border)}");
});

test("neutralizeHardcodedColors：半透明与未知色值不碰", () => {
  assert.equal(neutralizeHardcodedColors("div{background:rgba(255,255,255,0.08)}"), "div{background:rgba(255,255,255,0.08)}");
  assert.equal(neutralizeHardcodedColors("div{background:rgba(0,0,0,.5)}"), "div{background:rgba(0,0,0,.5)}");
  assert.equal(neutralizeHardcodedColors("div{background:var(--color-card)}"), "div{background:var(--color-card)}");
  assert.equal(neutralizeHardcodedColors("div{background:#534ab7}"), "div{background:#534ab7}");
});

test("neutralizeHardcodedColors：非颜色属性 / 非声明文本一律不动", () => {
  assert.equal(neutralizeHardcodedColors("div{width:100%;margin:12px}"), "div{width:100%;margin:12px}");
  assert.equal(neutralizeHardcodedColors("div{height:100vh}"), "div{height:100vh}");
  assert.equal(neutralizeHardcodedColors("见 https://example.com/a 说明"), "见 https://example.com/a 说明");
  // 时间/比例这类伪「属性:值」不应被当颜色
  assert.equal(neutralizeHardcodedColors("会议 12:30 开始"), "会议 12:30 开始");
});

/* ---------------- 组装 ---------------- */

test("sanitizeGenUiHtml：视口单位与颜色两趟都跑到", () => {
  const out = sanitizeGenUiHtml('<div style="height:100vh;background:#fff">x</div>');
  assert.equal(out, '<div style="height:100%;background:var(--color-card)">x</div>');
});

test("片段 HTML → 补齐外壳，代码落在 body，基线/运行时注入 head，且已消毒", () => {
  const html = buildGenUiSrcDoc('<div style="background:#fff">hi</div>');
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes('<body><div style="background:var(--color-card)">hi</div></body>'));
  assert.ok(html.includes("piwood.sendPrompt"));
  assert.ok(html.includes("piwood-genui-height"));
  assert.ok(html.includes(".pk-card{"));
});

test("完整文档（有 <head>）→ 基线插在 <head> 之后，不新增外层外壳", () => {
  const code = "<!doctype html><html><head><title>t</title></head><body>x</body></html>";
  const html = buildGenUiSrcDoc(code);
  assert.ok(html.indexOf("piwood.sendPrompt") > html.indexOf("<head>"));
  assert.ok(html.indexOf("piwood.sendPrompt") < html.indexOf("<title>"));
  assert.ok(html.includes("<title>t</title>"));
  assert.equal(html.match(/<html[\s>]/gi)?.length, 1);
});

test("完整文档（无 <head> 但有 <html>）→ 插在 <html> 之后", () => {
  const html = buildGenUiSrcDoc("<html><body>y</body></html>");
  assert.ok(html.includes("piwood.sendPrompt"));
  assert.equal(html.match(/<html[\s>]/gi)?.length, 1);
});

test("运行时：多帧上报 + 观测器 + 顶部子元素测量（不再单靠 scrollHeight）", () => {
  const html = buildGenUiSrcDoc("<p>x</p>");
  assert.ok(html.includes("getBoundingClientRect"));
  assert.ok(html.includes("requestAnimationFrame"));
  assert.ok(html.includes("ResizeObserver"));
  assert.ok(html.includes("MutationObserver"));
  assert.ok(html.includes("setTimeout(report, 1200)"));
  assert.ok(html.includes("data-piwood-prompt"));
});

test("基础样式在非浏览器环境（单测）不抛错，且样式块闭合", () => {
  const css = genUiBaseStyles();
  assert.ok(css.includes("box-sizing:border-box"));
  assert.ok(css.includes("var(--color-foreground)"));
  assert.ok(css.includes("color-scheme:"));
  assert.ok(css.includes("<style>"));
  assert.ok(css.endsWith("</style>"));
});
