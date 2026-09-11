/**
 * T11.1 生成式 UI —— **无 JSX / 无 DOM 依赖**的纯逻辑（围栏识别 + 输入消毒 + 沙箱文档组装）。
 *
 * 单独成文件的唯一理由：这一层要能在 `node --test` 里穷举。
 * 围栏标记、沙箱属性、视觉基线、颜色/视口单位消毒都属于「契约与安全」——
 * 一旦被改坏（放开同源、基线丢失导致深色底画出浅色块、`100vh` 把高度测量卡成死循环），
 * 必须是单测先红，而不是靠肉眼在看效果时发现。
 *
 * 视觉基线（GEN_UI_BASE_CSS + pk-* 类库）为什么必须存在：模型完全可以无视「只用令牌」的禁令，
 * 实测就会写出 `background:#fff` / `height:100vh` 这类东西——前者在深色主题上画出白色块（截图为证），
 * 后者让内容高度恒等于 iframe 高度、自动高度永远测不出真实值（表现为内容被截断 + 内部滚动条）。
 * 故本层做两件事：① 用 `!important` 把「高度/背景」这类会破坏测量的属性钉死；
 * ② 对模型产出的 HTML 做一次有界的**颜色与视口单位改写**（见 sanitizeGenUiHtml）。
 */

/** 生成式 UI 围栏：识别（含模型偶发写出的别名） */
export const GEN_UI_LANGUAGES: readonly string[] = ["genui", "genui-html", "genui_html"];

export function isGenUiLanguage(language: string | undefined): boolean {
  if (typeof language !== "string") return false;
  return GEN_UI_LANGUAGES.includes(language.trim().toLowerCase());
}

/** iframe sandbox 属性。**只允许** allow-scripts：给了 allow-same-origin 就等于把宿主同源交给模型代码 */
export const GEN_UI_SANDBOX_ATTR = "allow-scripts";

/**
 * `pk-*` 类库清单（沙箱内唯一的推荐写法）。提示词与基线 CSS 共用这份名单：
 * 提示词侧逐条列出、基线 CSS 逐条定义，两份单测各钉一次 ⇒ 任一侧改名都会红。
 */
export const GEN_UI_DESIGN_CLASSES: readonly string[] = [
  "pk-wrap",
  "pk-title",
  "pk-sub",
  "pk-card",
  "pk-grid",
  "pk-row",
  "pk-spread",
  "pk-badge",
  "pk-badge-primary",
  "pk-badge-success",
  "pk-badge-warning",
  "pk-badge-danger",
  "pk-btn",
  "pk-btn-primary",
  "pk-step",
  "pk-num",
  "pk-flow",
  "pk-kv",
  "pk-ink",
  "pk-code",
  "pk-hint",
];

/** `--color-<name>` ← 宿主 `:root` 上实际存在的语义变量（@theme inline 只内联，不进运行时） */
export const TOKEN_SOURCES: ReadonlyArray<readonly [string, string]> = [
  ["surface-app", "--surface-app"],
  ["surface-chrome", "--surface-chrome"],
  ["surface-right", "--surface-right"],
  ["background", "--background"],
  ["foreground", "--foreground"],
  ["card", "--card"],
  ["card-foreground", "--card-foreground"],
  ["popover", "--popover"],
  ["popover-foreground", "--popover-foreground"],
  ["primary", "--primary"],
  ["primary-foreground", "--primary-foreground"],
  ["secondary", "--secondary"],
  ["secondary-foreground", "--secondary-foreground"],
  ["muted", "--muted"],
  ["muted-foreground", "--muted-foreground"],
  ["accent", "--accent"],
  ["accent-foreground", "--accent-foreground"],
  ["destructive", "--destructive"],
  ["success", "--success"],
  ["warning", "--warning"],
  ["border", "--border"],
  ["input", "--input"],
  ["ring", "--ring"],
  ["ink-heading", "--ink-heading"],
  ["ink-body", "--ink-body"],
  ["ink-secondary", "--ink-secondary"],
  ["ink-muted", "--ink-muted"],
];

/* ------------------------------------------------------------------ */
/* 输入消毒：视口单位 + 硬编码颜色                                       */
/* ------------------------------------------------------------------ */

const VIEWPORT_UNIT_RE = /(\d*\.?\d+)(vh|dvh|svh|lvh|vw|dvw|svw|lvw)\b/gi;

/**
 * `100vh` 这类单位在 iframe 内是**自指**的（vh = iframe 高度 = 我们正在测量的值），
 * 会让 `scrollHeight` 恒等于当前高度 ⇒ 自动高度永远收敛不到真实内容高度（截断 + 内部滚动条）。
 * 只改写 100 这一档（≥100 一律归 100%）——小比例 vh（如 40vh）不形成自指死循环，保持原意。
 */
export function neutralizeViewportUnits(code: string): string {
  return code.replace(VIEWPORT_UNIT_RE, (match, num: string, unit: string) =>
    Number(num) >= 100 ? "100%" : match,
  );
}

/** 三档灰阶：浅（白底系）／深（黑底系）／中性（次要文字系）。每条 hex 自动派生 `rgb(r,g,b)` 形式。 */
const LIGHT_HEX = [
  "#fff", "#ffffff", "#fefefe", "#fdfdfd", "#fcfcfc", "#fbfbfb", "#fafafa", "#f9f9f9", "#f8f9fa",
  "#f7f7f7", "#f6f6f6", "#f5f5f5", "#f4f4f4", "#f3f3f3", "#f2f2f2", "#f1f1f1", "#f0f0f0",
  "#efefef", "#eee", "#eeeeee", "#ededed", "#eaeaea", "#e8e8e8", "#e5e5e5", "#e3e3e3",
  "#e2e2e2", "#e0e0e0", "#ddd", "#dddddd", "#dcdcdc", "#d9d9d9", "#d8d8d8", "#d3d3d3",
  "#ccc", "#cccccc", "#c9c9c9", "#c0c0c0",
];
const DARK_HEX = [
  "#000", "#000000", "#0a0a0a", "#0d0d0d", "#101010", "#111", "#111111", "#141414",
  "#161616", "#181818", "#1a1a1a", "#1c1c1c", "#1e1e1e", "#1f1f1f", "#202020", "#212121",
  "#222", "#222222", "#242424", "#262626", "#282828", "#2a2a2a", "#2b2b2b", "#2d2d2d",
  "#2e2e2e", "#303030", "#333", "#333333", "#3a3a3a", "#3c3c3c",
];
const MUTED_HEX = [
  "#444", "#444444", "#4d4d4d", "#4f4f4f", "#555", "#555555", "#5a5a5a", "#5f5f5f",
  "#616161", "#666", "#666666", "#6b6b6b", "#6e6e6e", "#707070", "#757575", "#777",
  "#777777", "#7a7a7a", "#7e7e7e", "#808080", "#888", "#888888", "#8a8a8a", "#8e8e8e",
  "#999", "#999999", "#9a9a9a", "#9e9e9e", "#a0a0a0", "#aaa", "#aaaaaa", "#b0b0b0",
  "#b4b4b4", "#bbb", "#bbbbbb",
];

function hexVariants(hex: string): string[] {
  const raw = hex.slice(1);
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // 原样（含 3 位缩写）+ 补全 6 位 + rgb() 三种写法都算命中
  return [`#${raw}`, `#${full}`, `rgb(${r},${g},${b})`];
}

const LIGHT_VALUES = new Set<string>([...LIGHT_HEX.flatMap(hexVariants), "white"]);
const DARK_VALUES = new Set<string>([...DARK_HEX.flatMap(hexVariants), "black"]);
const MUTED_VALUES = new Set<string>([...MUTED_HEX.flatMap(hexVariants), "gray", "grey"]);

const BG_PROPS = new Set(["background", "background-color"]);
const BORDER_PROPS = new Set([
  "border", "border-color", "border-top", "border-right", "border-bottom", "border-left",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "outline", "outline-color",
]);
const INK_PROPS = new Set(["color", "fill", "stroke", "caret-color", "text-decoration-color", "stop-color"]);

/** 归一化：小写、压空白、`rgb(a b c)` → `rgb(a,b,c)`（与 hexVariants 派生出的形式对齐） */
function normalizeColorToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",")
    .replace(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\)$/, "rgb($1,$2,$3)");
}

function mapColorToken(raw: string, prop: string): string | undefined {
  const value = normalizeColorToken(raw);
  // 带 alpha 的颜色一律不碰：半透明叠加是有意为之，替换会丢层次
  if (value.startsWith("rgba(") || value.startsWith("hsla(")) return undefined;
  const isBg = BG_PROPS.has(prop);
  const isBorder = BORDER_PROPS.has(prop);
  const isInk = INK_PROPS.has(prop);
  if (!isBg && !isBorder && !isInk) return undefined;
  if (LIGHT_VALUES.has(value)) {
    if (isBorder) return "var(--color-border)";
    if (isBg) return "var(--color-card)";
    return "var(--color-foreground)";
  }
  if (DARK_VALUES.has(value)) {
    if (isBorder) return "var(--color-border)";
    if (isBg) return "var(--color-muted)";
    return "var(--color-foreground)";
  }
  if (MUTED_VALUES.has(value)) {
    if (isBorder) return "var(--color-border)";
    if (isBg) return "var(--color-muted)";
    return "var(--color-muted-foreground)";
  }
  return undefined;
}

const DECLARATION_RE = /(^|[;{"'\s>])([a-zA-Z-]{3,24})\s*:\s*([^;{}"'<>`]+)/g;
const COLOR_TOKEN_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black|gray|grey)\b/gi;

/**
 * 有界改写：只在 `颜色类属性: 值` 的声明里，逐 token 替换**常见灰阶的硬编码色**为宿主令牌。
 * 保守点：只认整值匹配（`1px solid #e5e5e5` 里的 `#e5e5e5` 会被换、`#534ab7` 这类品牌色不动）、
 * 跳过带 alpha 的颜色、不进入引号内（JS 字符串里的色值不碰，避免改坏脚本）。
 */
export function neutralizeHardcodedColors(code: string): string {
  return code.replace(DECLARATION_RE, (match, lead: string, propRaw: string, value: string) => {
    const prop = propRaw.toLowerCase();
    if (!BG_PROPS.has(prop) && !BORDER_PROPS.has(prop) && !INK_PROPS.has(prop)) return match;
    let changed = false;
    const next = value.replace(COLOR_TOKEN_RE, (token) => {
      const mapped = mapColorToken(token, prop);
      if (!mapped) return token;
      changed = true;
      return mapped;
    });
    return changed ? `${lead}${propRaw}:${next}` : match;
  });
}

/** 组装前的统一消毒入口（顺序：先视口单位，再颜色） */
export function sanitizeGenUiHtml(code: string): string {
  return neutralizeHardcodedColors(neutralizeViewportUnits(code));
}

/* ------------------------------------------------------------------ */
/* 沙箱内运行时                                                        */
/* ------------------------------------------------------------------ */

/**
 * 高度测量口径（踩过坑，别简化）：
 * - 直接读 `scrollHeight` 会被 `body{height:100%}` / 包装层 `height:100vh` 拉平到视口高度 ⇒ 永远测不到真实值。
 *   故改为**取所有顶层子元素 bottom 的最大值**（内容 bbox），再与 scrollHeight/offsetHeight 取 max。
 * - 首帧（字体未就绪）+ 异步内容（`setTimeout` 渲染、图片解码）都会让首次测量偏小，
 *   故：连续 90 帧逐帧上报（只在变化时发）+ ResizeObserver + MutationObserver + load 兜底。
 */
export const GEN_UI_SANDBOX_RUNTIME = `<script>(function(){
  function post(type, payload){ try { parent.postMessage(Object.assign({ type: type }, payload || {}), "*"); } catch (e) {} }
  function measure(){
    var b = document.body, d = document.documentElement;
    if (!b) return 0;
    var top = b.getBoundingClientRect().top;
    var max = 0;
    var kids = b.children;
    for (var i = 0; i < kids.length; i++) {
      var r = kids[i].getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.bottom - top > max) max = r.bottom - top;
    }
    var sc = Math.max(b.scrollHeight || 0, b.offsetHeight || 0, d ? (d.scrollHeight || 0) : 0);
    return Math.ceil(Math.max(max, sc));
  }
  var last = -1;
  function report(){
    var h = measure();
    if (h > 0 && h !== last) { last = h; post("piwood-genui-height", { height: h }); }
    return h;
  }
  window.piwood = {
    sendPrompt: function(text){
      if (typeof text === "string" && text.trim()) post("piwood-genui-prompt", { text: text.trim() });
    }
  };
  function boot(){
    report();
    var frames = 0;
    (function tick(){
      report();
      if (++frames < 90) requestAnimationFrame(tick);
    })();
    window.addEventListener("load", report);
    window.addEventListener("resize", report);
    setTimeout(report, 120);
    setTimeout(report, 400);
    setTimeout(report, 1200);
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(report);
      try { ro.observe(document.documentElement); if (document.body) ro.observe(document.body); } catch (e) {}
    }
    if (window.MutationObserver && document.body) {
      try { new MutationObserver(report).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true }); } catch (e) {}
    }
    document.addEventListener("click", function(ev){
      var el = ev.target && ev.target.closest ? ev.target.closest("[data-piwood-prompt]") : null;
      if (!el) return;
      ev.preventDefault();
      window.piwood.sendPrompt(el.getAttribute("data-piwood-prompt") || el.textContent || "");
    }, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();<\/script>`;

/* ------------------------------------------------------------------ */
/* 视觉基线与类库                                                      */
/* ------------------------------------------------------------------ */

/**
 * 基线样式。前三条是**测量与主题的安全带**，一律 `!important`（模型的同名普通声明压不过它）：
 * 1. `html,body{height:auto;min-height:0;max-height:none}` —— 拆掉自指高度；
 * 2. `background:transparent` —— 背景由宿主卡片提供，模型不该铺底；
 * 3. 字族/字号/行高定档 —— 默认 UA 样式在窄栏里又大又散。
 * 其后是 `pk-*` 类库：扁平、克制、只用令牌取色，深/浅色自动跟随。
 */
export const GEN_UI_BASE_CSS = `*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;background:transparent;background:transparent !important;height:auto !important;min-height:0 !important;max-height:none !important;overflow-x:hidden}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:13.5px;line-height:1.6;color:var(--color-foreground);-webkit-font-smoothing:antialiased;word-break:break-word}
h1,h2,h3,h4,h5,h6,p,ul,ol,figure,blockquote{margin:0}
h1,h2,h3,h4,h5,h6{font-weight:500;line-height:1.35;color:var(--color-foreground)}
h1{font-size:15px}h2{font-size:14px}h3{font-size:13.5px}
ul,ol{padding-left:18px}
li{margin:2px 0}
a{color:var(--color-primary);text-decoration:none}
img,svg,canvas,video{max-width:100%;height:auto}
button,input,select,textarea{font:inherit;color:inherit}
code,kbd,samp{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;background:var(--color-muted);border-radius:8px;padding:10px;margin:0;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:12.5px}
th,td{border-bottom:1px solid var(--color-border);padding:6px 8px;text-align:left;vertical-align:top}
th{color:var(--color-muted-foreground);font-weight:500}
hr{border:0;border-top:1px solid var(--color-border);margin:2px 0}
::selection{background:var(--color-selection,var(--color-accent))}
.pk-wrap{display:flex;flex-direction:column;gap:10px;width:100%}
.pk-title{font-size:14px;font-weight:500;color:var(--color-foreground)}
.pk-sub{font-size:12px;color:var(--color-muted-foreground)}
.pk-card{border:1px solid var(--color-border);border-radius:8px;padding:12px;background:var(--color-card)}
.pk-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px}
.pk-row{display:flex;align-items:center;gap:8px}
.pk-spread{display:flex;align-items:center;justify-content:space-between;gap:8px}
.pk-badge{display:inline-block;flex:none;font-size:11px;line-height:1.6;padding:0 6px;border-radius:6px;border:1px solid var(--color-border);color:var(--color-muted-foreground);white-space:nowrap}
.pk-badge-primary{border-color:var(--color-primary);color:var(--color-primary)}
.pk-badge-success{border-color:var(--color-success);color:var(--color-success)}
.pk-badge-warning{border-color:var(--color-warning);color:var(--color-warning)}
.pk-badge-danger{border-color:var(--color-destructive);color:var(--color-destructive)}
.pk-btn{display:inline-flex;align-items:center;gap:6px;cursor:pointer;border:1px solid var(--color-border);border-radius:8px;padding:5px 10px;font-size:12.5px;line-height:1.5;background:transparent;color:var(--color-foreground);transition:background-color .12s ease,border-color .12s ease}
.pk-btn:hover{background:var(--color-accent);border-color:var(--color-ring)}
.pk-btn-primary{background:var(--color-primary);border-color:transparent;color:var(--color-primary-foreground)}
.pk-btn-primary:hover{background:var(--color-primary);border-color:var(--color-ring)}
.pk-step{display:flex;align-items:flex-start;gap:8px}
.pk-num{flex:none;width:18px;height:18px;margin-top:1px;border-radius:50%;background:var(--color-accent);color:var(--color-muted-foreground);font-size:11px;display:grid;place-items:center}
.pk-flow{display:flex;justify-content:center;color:var(--color-muted-foreground);font-size:12px;line-height:1}
.pk-kv{display:flex;align-items:baseline;gap:8px;padding:4px 0;border-bottom:1px dashed var(--color-border)}
.pk-kv:last-child{border-bottom:0}
.pk-ink{color:var(--color-foreground)}
.pk-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;background:var(--color-muted);border-radius:4px;padding:1px 4px}
.pk-hint{font-size:11.5px;color:var(--color-muted-foreground)}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-thumb{background:var(--color-border);border-radius:3px}
::-webkit-scrollbar-track{background:transparent}`;

/** 宿主主题令牌 → `:root` 内联声明串。非浏览器环境（单测）返回空串，不抛错。 */
export function resolveTokenCss(): string {
  if (typeof document === "undefined") return "";
  const cs = getComputedStyle(document.documentElement);
  const out: string[] = [];
  for (const [name, src] of TOKEN_SOURCES) {
    const value = cs.getPropertyValue(src).trim();
    if (!value) continue;
    out.push(`--${name}:${value};--color-${name}:${value};`);
  }
  const radius = cs.getPropertyValue("--radius").trim() || "8px";
  out.push(`--radius:${radius};`);
  return out.join("");
}

/** 宿主是否浅色（globals.css 的口径：仅显式 data-theme="light" 走浅色） */
export function isHostLightTheme(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-theme") === "light";
}

export function genUiBaseStyles(): string {
  const scheme = isHostLightTheme() ? "light" : "dark";
  return `<style>
:root{${resolveTokenCss()}color-scheme:${scheme}}
${GEN_UI_BASE_CSS}
</style>`;
}

/** 模型写了完整文档（<html>/<!doctype>）时把令牌与运行时插进 <head>，否则补齐外壳 */
export function buildGenUiSrcDoc(rawCode: string): string {
  const code = sanitizeGenUiHtml(rawCode);
  const head = `${genUiBaseStyles()}${GEN_UI_SANDBOX_RUNTIME}`;
  const isFullDocument = /<!doctype/i.test(code) || /<html[\s>]/i.test(code);
  if (isFullDocument) {
    if (/<head[^>]*>/i.test(code)) return code.replace(/<head[^>]*>/i, (m) => `${m}${head}`);
    if (/<html[^>]*>/i.test(code)) return code.replace(/<html[^>]*>/i, (m) => `${m}${head}`);
    return `${head}${code}`;
  }
  return `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${code}</body></html>`;
}
