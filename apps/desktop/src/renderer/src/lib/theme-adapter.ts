/**
 * T3.3 主题 token 映射：把 Pi Theme JSON（{ vars: {name:hex}, colors: {token: name|hex} }）
 * 归一化成扁平 token→hex，再映射到桌面应用的 CSS 变量 / xterm / shiki 取色。
 *
 * 纯函数、无 electron/DOM 依赖，可被 node --test 直接跑（对齐项目纯逻辑分层约定）。
 * 语义映射表见方案 §5.4。桌面保留自身精修的分层底色（--surface-app/chrome），
 * Pi 主题只驱动「前景/强调/边框/状态/工具/语法/终端」等语义色，避免覆盖用户手调的柔和深灰底。
 */

export interface PiThemeJson {
  name?: string;
  vars?: Record<string, string | number>;
  colors?: Record<string, string | number>;
}

/** token → 解析后的 hex（vars 间接引用已展开）。 */
export type PiThemeColors = Record<string, string>;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function toHex(raw: string | number | undefined, vars: Record<string, string | number>): string | undefined {
  if (raw === undefined) return undefined;
  // 直接是 hex
  if (typeof raw === "string" && HEX.test(raw)) return raw.toLowerCase();
  // 是 var 引用名
  if (typeof raw === "string" && raw in vars) return toHex(vars[raw], vars);
  // 数字（256 色索引）→ 无法可靠转 hex，交回 undefined 由上层兜底
  return undefined;
}

/** 把 Pi theme JSON 解析成扁平 token→hex（vars 展开、非法/256 色值跳过）。 */
export function resolvePiTheme(theme: PiThemeJson): PiThemeColors {
  const vars = theme.vars ?? {};
  const colors = theme.colors ?? {};
  const out: PiThemeColors = {};
  for (const [token, ref] of Object.entries(colors)) {
    const hex = toHex(ref, vars);
    if (hex) out[token] = hex;
  }
  return out;
}

/** 依据前景色亮度判定该主题更适合 dark 还是 light 底色层。 */
export function themeModeFromFg(fg: string | undefined): "dark" | "light" {
  if (!fg) return "dark";
  const m = fg.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return "dark";
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "dark" : "light"; // 前景偏亮 → 深色底；前景偏暗 → 浅色底
}

/** Pi token → 桌面 CSS 变量覆盖（仅语义色，不动 --surface/--background 底色层）。 */
export function piThemeToCssVars(c: PiThemeColors): Record<string, string> {
  const vars: Record<string, string> = {};
  const set = (k: string, v: string | undefined): void => {
    if (v) vars[k] = v;
  };
  set("--foreground", c.text);
  set("--muted-foreground", c.muted ?? c.dim);
  set("--primary", c.accent);
  set("--ring", c.accent);
  set("--sidebar-primary", c.accent);
  set("--border", c.border);
  set("--input", c.borderMuted ?? c.border);
  set("--sidebar-border", c.borderMuted ?? c.border);
  set("--success", c.success);
  set("--destructive", c.error);
  set("--warning", c.warning);
  set("--accent", c.selectedBg);
  // 工具卡分类色（左侧色条 / 状态底）
  set("--pi-tool-read", c.mdCode);
  set("--pi-tool-edit", c.accent);
  set("--pi-tool-bash", c.mdHeading ?? c.accent);
  set("--pi-tool-error", c.toolErrorBg);
  set("--pi-tool-success", c.toolSuccessBg);
  // 语法高亮（供 shiki 派生）
  set("--pi-syntax-comment", c.syntaxComment);
  set("--pi-syntax-keyword", c.syntaxKeyword);
  set("--pi-syntax-function", c.syntaxFunction);
  set("--pi-syntax-variable", c.syntaxVariable);
  set("--pi-syntax-string", c.syntaxString);
  set("--pi-syntax-number", c.syntaxNumber);
  set("--pi-syntax-type", c.syntaxType);
  set("--pi-syntax-operator", c.syntaxOperator);
  set("--pi-syntax-punctuation", c.syntaxPunctuation);
  // 终端取色
  set("--pi-terminal-fg", c.text);
  return vars;
}

/** 供 xterm `options.theme` 用的最小配色（背景沿用传入的 surface）。 */
export function piThemeToTerminalTheme(
  c: PiThemeColors,
  surface: string,
): { background: string; foreground: string; cursor: string } {
  return {
    background: surface,
    foreground: c.text ?? "#d4d4d4",
    cursor: c.accent ?? "#8abeb7",
  };
}

/**
 * 供 shiki 的自定义主题（ThemeRegistration 结构）：把 Pi 语法 token 映射到
 * 常见 TextMate scope。缺 token 时返回 undefined，调用方回退内置主题。
 */
export interface ShikiThemeLike {
  name: string;
  type: "dark" | "light";
  colors: Record<string, string>;
  tokenColors: Array<{ scope: string[]; settings: { foreground?: string; fontStyle?: string } }>;
}

export function piThemeToShikiTheme(c: PiThemeColors, mode: "dark" | "light"): ShikiThemeLike | undefined {
  const hasSyntax =
    c.syntaxComment || c.syntaxKeyword || c.syntaxString || c.syntaxFunction || c.syntaxNumber;
  if (!hasSyntax) return undefined; // 无语法 token → 不覆盖，用内置
  const fg = c.text ?? (mode === "dark" ? "#d4d4d4" : "#24292e");
  const bg = mode === "dark" ? "#181818" : "#ffffff";
  const tok = (name: string, scope: string[], fontStyle?: string) =>
    c[name] ? { scope, settings: { foreground: c[name], fontStyle } } : null;
  const tokenColors = [
    tok("syntaxComment", ["comment", "punctuation.definition.comment"], "italic"),
    tok("syntaxKeyword", ["keyword", "storage.type", "storage.modifier"]),
    tok("syntaxFunction", ["entity.name.function", "meta.function-call.generic", "support.function"]),
    tok("syntaxString", ["string", "punctuation.definition.string"]),
    tok("syntaxNumber", ["constant.numeric"]),
    tok("syntaxType", ["entity.name.type", "support.type", "support.class"]),
    tok("syntaxVariable", ["variable", "meta.variable"]),
    tok("syntaxOperator", ["keyword.operator"]),
    tok("syntaxPunctuation", ["punctuation"]),
  ].filter(Boolean) as ShikiThemeLike["tokenColors"];
  return {
    name: "pi-wood",
    type: mode,
    colors: { "editor.background": bg, "editor.foreground": fg },
    tokenColors,
  };
}
