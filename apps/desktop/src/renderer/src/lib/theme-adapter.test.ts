import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePiTheme,
  themeModeFromFg,
  piThemeToCssVars,
  piThemeToTerminalTheme,
  piThemeToShikiTheme,
} from "./theme-adapter.ts";

// 复刻 pi-coding-agent dark.json 的结构（vars 命名色 + colors token→引用|hex）
const dark = {
  name: "dark",
  vars: { cyan: "#00d7ff", accent: "#8abeb7", text: "#d4d4d4", gray: "#808080", green: "#b5bd68", red: "#cc6666", selectedBg: "#3a3a4a" },
  colors: {
    accent: "accent",
    border: "cyan",
    text: "text",
    muted: "gray",
    success: "green",
    error: "red",
    selectedBg: "selectedBg",
    customMessageLabel: "#9575cd", // 直接 hex
    syntaxComment: "gray",
    syntaxKeyword: "cyan",
    dim: 240, // 256 色索引 → 跳过
  },
};

test("resolvePiTheme 展开 vars 引用 + 保留直接 hex + 跳过 256 色数字", () => {
  const c = resolvePiTheme(dark);
  assert.equal(c.accent, "#8abeb7");
  assert.equal(c.border, "#00d7ff"); // cyan var
  assert.equal(c.customMessageLabel, "#9575cd"); // 直接 hex
  assert.equal(c.syntaxKeyword, "#00d7ff");
  assert.ok(!("dim" in c), "256 色索引应被跳过");
});

test("themeModeFromFg：亮前景→dark、暗前景→light", () => {
  assert.equal(themeModeFromFg("#ffffff"), "dark");
  assert.equal(themeModeFromFg("#111111"), "light");
  assert.equal(themeModeFromFg(undefined), "dark");
});

test("piThemeToCssVars 映射语义色、不动 --background/--surface", () => {
  const vars = piThemeToCssVars(resolvePiTheme(dark));
  assert.equal(vars["--foreground"], "#d4d4d4");
  assert.equal(vars["--primary"], "#8abeb7");
  assert.equal(vars["--ring"], "#8abeb7");
  assert.equal(vars["--border"], "#00d7ff");
  assert.equal(vars["--success"], "#b5bd68");
  assert.equal(vars["--destructive"], "#cc6666");
  assert.equal(vars["--accent"], "#3a3a4a");
  assert.equal(vars["--muted-foreground"], "#808080");
  assert.ok(!("--background" in vars) && !("--surface-app" in vars), "不应覆盖底色层");
});

test("piThemeToTerminalTheme 用传入 surface 作背景", () => {
  const t = piThemeToTerminalTheme(resolvePiTheme(dark), "#181818");
  assert.equal(t.background, "#181818");
  assert.equal(t.foreground, "#d4d4d4");
  assert.equal(t.cursor, "#8abeb7");
});

test("piThemeToShikiTheme：有语法 token 生成主题，无则 undefined", () => {
  const withSyntax = piThemeToShikiTheme(resolvePiTheme(dark), "dark");
  assert.ok(withSyntax);
  assert.equal(withSyntax!.type, "dark");
  assert.ok(withSyntax!.tokenColors.some((tc) => tc.settings.foreground === "#00d7ff"));
  const noSyntax = piThemeToShikiTheme({ text: "#fff" }, "dark");
  assert.equal(noSyntax, undefined);
});
