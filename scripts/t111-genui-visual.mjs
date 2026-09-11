/**
 * T11.1 生成式 UI —— 视觉回归探针（离线，不启动 Electron）
 *
 * 用途：把「模型真实产出的 genui 块」在**宿主主题令牌下**渲染出来，和「无基线」的旧观感做对照，
 * 用来在不跑真机的前提下守住三条视觉契约（透明底 / 不截断 / 深层可读）。
 *
 * 为什么需要它：`node --test` 只能断言「基线 CSS 里有 !important 高度拆解、没有 vh」这类**字面**性质，
 * 断言不了「渲染出来到底长什么样」。这个探针补的就是那一眼。
 *
 * 运行：
 *   node scripts/t111-genui-visual.mjs                 # 自动取最新含 genui 块的会话产出
 *   node scripts/t111-genui-visual.mjs --sample a.html # 指定样本
 *   node scripts/t111-genui-visual.mjs --out x.png
 *
 * 前置：`pnpm --filter pi-wood-desktop exec electron-vite build`（要读 out/renderer/assets/index-*.css 取宿主令牌真值）
 *
 * 两个已知坑（别绕）：
 *   - `NODE_PATH` 对 ESM import **无效** ⇒ playwright-core 用绝对路径 import；
 *   - 纯 node **不能 import *.ts** ⇒ 先 esbuild --bundle 出 .mjs 再动态 import。
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir, tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "apps/desktop");
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

/* ---------- 1. 取样本：优先 --sample，否则从会话里捞最新含 genui 的产出 ---------- */
function extractLatestGenUiBlock() {
  const root = join(homedir(), ".pi", "agent", "sessions");
  if (!existsSync(root)) return null;
  const files = [];
  for (const dir of readdirSync(root)) {
    const abs = join(root, dir);
    if (!statSync(abs).isDirectory()) continue;
    for (const f of readdirSync(abs)) {
      if (f.endsWith(".jsonl")) files.push({ p: join(abs, f), m: statSync(join(abs, f)).mtimeMs });
    }
  }
  files.sort((a, b) => b.m - a.m);
  for (const { p } of files) {
    const raw = readFileSync(p, "utf8");
    if (!raw.includes("```genui")) continue;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const content = (obj.message ?? obj).content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (c?.type !== "text" || typeof c.text !== "string") continue;
        const m = c.text.match(/```genui[^\n]*\n([\s\S]*?)```/);
        if (m) return { code: m[1], from: p };
      }
    }
  }
  return null;
}

const sampleArg = argOf("sample");
let rawModelOutput;
let sampleFrom;
if (sampleArg) {
  rawModelOutput = readFileSync(resolve(sampleArg), "utf8");
  sampleFrom = resolve(sampleArg);
} else {
  const found = extractLatestGenUiBlock();
  if (!found) throw new Error("会话里找不到任何 genui 块，请用 --sample <file> 指定样本");
  rawModelOutput = found.code;
  sampleFrom = found.from;
}
console.log("样本:", sampleFrom, `(${rawModelOutput.length} B)`);

/* ---------- 2. 把 gen-ui-core.ts 打包成可 import 的 .mjs ---------- */
const require = createRequire(join(APP, "package.json"));
let esbuildBin;
{
  const pnpmDir = join(ROOT, "node_modules/.pnpm");
  const hit = readdirSync(pnpmDir).find((d) => d.startsWith("esbuild@"));
  if (!hit) throw new Error("找不到 esbuild，无法打包 gen-ui-core.ts");
  esbuildBin = join(pnpmDir, hit, "node_modules/esbuild/bin/esbuild");
}
const corePath = join(ROOT, "packages/ui-kit/src/gen-ui-core.ts");
const bundled = join(tmpdir(), `t111-gen-ui-core-${process.pid}.mjs`);
execFileSync(esbuildBin, [corePath, "--bundle", "--format=esm", "--platform=neutral", `--outfile=${bundled}`, "--log-level=warning"], {
  cwd: ROOT,
});
const { buildGenUiSrcDoc, sanitizeGenUiHtml, GEN_UI_SANDBOX_RUNTIME, GEN_UI_BASE_CSS, TOKEN_SOURCES } = await import(
  pathToFileURL(bundled).href
);

/* ---------- 3. playwright-core 必须绝对路径 import ---------- */
// 注意：playwright-core 的入口是 CJS，经 import() 拿到的命名导出依赖 cjs-module-lexer 的识别，
// 不稳定 ⇒ 统一从 default 上取，再退回命名导出。
const pwPath = require.resolve("playwright-core");
const pwMod = await import(pathToFileURL(pwPath).href);
const { chromium } = pwMod.default ?? pwMod;

/* ---------- 4. 宿主令牌真值：从真实构建产物里读 ---------- */
const assetsDir = join(APP, "out/renderer/assets");
const cssFile = existsSync(assetsDir) && readdirSync(assetsDir).find((f) => f.startsWith("index-") && f.endsWith(".css"));
if (!cssFile) throw new Error("找不到 out/renderer/assets/index-*.css，先跑 electron-vite build");
const HOST_CSS = readFileSync(join(assetsDir, cssFile), "utf8");
console.log("宿主 CSS:", cssFile, `${(HOST_CSS.length / 1024).toFixed(0)} KB`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 760, height: 1500 }, deviceScaleFactor: 2 });
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${HOST_CSS}</style></head><body></body></html>`);
const tokenMap = await page.evaluate(
  (sources) => {
    const cs = getComputedStyle(document.documentElement);
    const out = {};
    for (const [name, src] of sources) out[src] = cs.getPropertyValue(src).trim();
    out["--radius"] = cs.getPropertyValue("--radius").trim() || "8px";
    return out;
  },
  TOKEN_SOURCES,
);
const missing = Object.entries(tokenMap).filter(([, v]) => !v).map(([k]) => k);
console.log("宿主令牌命中:", `${Object.keys(tokenMap).length - missing.length}/${Object.keys(tokenMap).length}`);
if (missing.length) console.log("未命中:", missing.join(", "));

/* ---------- 5. 让 gen-ui-core 的 resolveTokenCss() 在 Node 侧能跑 ---------- */
globalThis.document = { documentElement: { getAttribute: () => null } }; // null ⇒ 深色主题
globalThis.getComputedStyle = () => ({ getPropertyValue: (k) => tokenMap[k] ?? "" });

/* ---------- 6. 组对照 ---------- */
function legacySrcDoc(raw) {
  const tokens = Object.entries(tokenMap)
    .filter(([k, v]) => k !== "--radius" && v)
    .map(([k, v]) => `${k}:${v};`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>:root{${tokens}}</style></head><body>${raw}</body></html>`;
}

/** 提示词禁令压不住的那类输出：硬编码浅色 + 100vh */
const BAD_SAMPLE = `
<div style="height:100vh;background:#ffffff;padding:16px;border-radius:8px">
  <div style="color:#111111;font-size:18px;font-weight:600">模型随手写的浅色卡片</div>
  <div style="color:#666666;background:#f8f9fa;border:1px solid #e5e5e5;padding:10px;margin-top:8px">
    这是提示词禁令没有约束住的典型输出：底白、字黑、高 100vh。
  </div>
  <div style="display:flex;gap:8px;margin-top:12px">
    <span style="background:#ffffff;border:1px solid #cccccc;color:#333333;padding:4px 10px;border-radius:6px">按钮 A</span>
    <span style="background:#000000;color:#ffffff;padding:4px 10px;border-radius:6px">按钮 B</span>
  </div>
</div>
`;

const NEW_HEIGHT = 560;
const panels = [
  { id: "legacy", title: "① 旧渲染（无基线 / 无消毒 / 高度定死 220px）", note: "复现问题截图：iframe 画布白底 + 内容被截断 + 内部滚动条", srcDoc: legacySrcDoc(rawModelOutput), height: 220 },
  { id: "baseline", title: "② 仅加视觉基线（透明底 / 深色 scheme / 高度自适应）", note: "白底消失、深色跟随宿主；本样本恰好只用令牌，故样式已经正确", srcDoc: buildGenUiSrcDoc(rawModelOutput), height: NEW_HEIGHT },
  { id: "bad-legacy", title: "③ 硬编码坏样本 · 旧渲染", note: "浅色底 + 100vh：与宿主深色主题冲突，且 100vh 让高度自指", srcDoc: legacySrcDoc(BAD_SAMPLE), height: 220 },
  { id: "bad-new", title: "④ 硬编码坏样本 · 新管线（消毒 + 基线）", note: "灰阶被改写成令牌、100vh 归 100%，深色主题下不再割裂", srcDoc: buildGenUiSrcDoc(BAD_SAMPLE), height: NEW_HEIGHT },
];

const iframeHtml = (p) =>
  `<iframe class="genui-frame" id="f-${p.id}" sandbox="allow-scripts" srcDoc="${p.srcDoc.replace(/"/g, "&quot;")}" style="height:${p.height}px"></iframe>`;

const hostHtml = `<!doctype html><html><head><meta charset="utf-8">
<style>${HOST_CSS}</style>
<style>
  body{margin:0;background:var(--surface-app);color:var(--ink-body);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
  .wrap{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:24px}
  .cell{display:flex;flex-direction:column;gap:8px;min-width:0}
  .cap{font-size:12px;color:var(--ink-heading);font-weight:600}
  .sub{font-size:11px;color:var(--ink-muted);line-height:1.5;min-height:32px}
  .genui-frame{width:100%;border:1px solid var(--border);border-radius:8px;background:transparent;display:block}
  .clamp{font-size:10px;color:var(--ink-tertiary)}
</style></head>
<body><div class="wrap">${panels
  .map(
    (p) => `<div class="cell"><div class="cap">${p.title}</div><div class="sub">${p.note}</div>${iframeHtml(p)}<div class="clamp" id="h-${p.id}">实测高度：—</div></div>`,
  )
  .join("")}</div>
<script>
  // 宿主侧监听，等价于 GenUiBlock 的逻辑（含 event.source 校验 + clamp）
  var watched = { "f-${panels[1].id}": 1, "f-${panels[3].id}": 1 };
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.type !== "piwood-genui-height" || typeof d.height !== "number") return;
    var id = null;
    for (var k in watched) { var el = document.getElementById(k); if (el && e.source === el.contentWindow) id = k; }
    if (!id) return;
    var h = Math.max(40, Math.min(6000, Math.ceil(d.height)));
    document.getElementById(id).style.height = h + "px";
    document.getElementById("h-" + id.slice(2)).textContent = "实测高度：" + h + "px";
  });
</script></body></html>`;

await page.setContent(hostHtml);
await page.waitForTimeout(2200); // 等 90 帧 rAF + 120/400/1200ms 兜底

const reported = await page.evaluate(() => Array.from(document.querySelectorAll(".clamp")).map((e) => e.textContent));
console.log("高度上报:", reported.join(" | "));

const outDir = join(APP, "docs/proofs/ui-v3");
mkdirSync(outDir, { recursive: true });
const shot = resolve(argOf("out", join(outDir, "gen-ui-sandbox.png")));
await page.screenshot({ path: shot, fullPage: true });

/* ---------- 7. 字面证据 ---------- */
const sanitizedBad = sanitizeGenUiHtml(BAD_SAMPLE);
const evidence = {
  模型输出含硬编码灰阶: /#[0-9a-fA-F]{3,8}\b/.test(rawModelOutput),
  模型输出含视口单位: /\d+(?:\.\d+)?vh/.test(rawModelOutput),
  消毒是否改变真实样本: sanitizeGenUiHtml(rawModelOutput) !== rawModelOutput,
  基线含透明底: GEN_UI_BASE_CSS.includes("background:transparent !important"),
  基线含高度拆解: GEN_UI_BASE_CSS.includes("height:auto !important"),
  基线含vh: /\d(?:vh|vw|dvh|svh|lvh)\b/.test(GEN_UI_BASE_CSS),
  运行时含高度上报: GEN_UI_SANDBOX_RUNTIME.includes("piwood-genui-height"),
  坏样本消毒后残留: {
    "100vh": /100vh/.test(sanitizedBad),
    "#f8f9fa": /f8f9fa/i.test(sanitizedBad),
    "#e5e5e5": /e5e5e5/i.test(sanitizedBad),
  },
};
console.log(JSON.stringify(evidence, null, 2));

await browser.close();
writeFileSync("/dev/null", "");
console.log("截图:", shot, `(${(statSync(shot).size / 1024).toFixed(0)} KB)`);
