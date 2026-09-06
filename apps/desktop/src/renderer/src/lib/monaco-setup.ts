/**
 * Monaco 本地化装配（桌面应用必须离线可用）：
 * - @monaco-editor/react 默认从 CDN loader 拉_monaco_，这里 loader.config 直接喂本地 npm 包；
 * - worker 用 vite `?worker` 语法打包成本地 Worker（JSON 校验/TS 检查都跑在 worker 里）；
 * - 主题 piwood-dark：vs-dark 基底 + 透明编辑器背景，融入面板底色。
 */
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
// monaco-editor 0.56 的 exports 深路径映射（`./*.js` → `./esm/vs/*.js`）；带 .js 后缀 + query 才能被 vite 稳定解析
import editorWorker from "monaco-editor/editor/editor.worker.js?worker";
import cssWorker from "monaco-editor/language/css/css.worker.js?worker";
import htmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import jsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

loader.config({ monaco });

/** 扩展名 → Monaco 语言 id（monaco-editor basic-languages 内置集合） */
const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  vue: "html",
  svelte: "html",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  xml: "xml",
  svg: "xml",
  py: "python",
  rb: "ruby",
  php: "php",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "cpp",
  h: "cpp",
  cpp: "cpp",
  cc: "cpp",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ps1: "powershell",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  lua: "lua",
  pl: "perl",
  dart: "dart",
};

export function monacoLanguage(path: string): string {
  const ext = path.toLowerCase().includes(".") ? path.toLowerCase().split(".").pop()! : "";
  return LANG_BY_EXT[ext] ?? "plaintext";
}

monaco.editor.defineTheme("piwood-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    // 透明背景：编辑器融入面板底色，不再自己发灰
    "editor.background": "#00000000",
    "editorGutter.background": "#00000000",
    "editorLineNumber.foreground": "#5b5f6a",
    "editorLineNumber.activeForeground": "#9da3b0",
  },
});

export { monaco };
