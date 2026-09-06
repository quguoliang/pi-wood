/**
 * 文件树图标（vscode-icons 主题，纯离线）：
 * - @iconify-json/vscode-icons 全量图标经 addCollection 注册进 iconify 运行时，不联网取图；
 * - 映射只列高频文件名/扩展名（id 均已对照 icons.json 核实），未命中回退 default-file——
 *   与 VSCode 的 fallback 行为一致；
 * - 目录固定 default-folder / default-folder-opened，不按目录名换色（保持克制）。
 */
import { addCollection, Icon as Iconify } from "@iconify/react";
import vscodeIcons from "@iconify-json/vscode-icons/icons.json";

addCollection(vscodeIcons);

const PREFIX = "vscode-icons:";

/** 特殊文件名（完整匹配，小写）→ 图标 id */
const BY_NAME: Record<string, string> = {
  "package.json": "file-type-node",
  "pnpm-lock.yaml": "file-type-light-pnpm",
  ".gitignore": "file-type-git",
  ".gitattributes": "file-type-git",
  ".gitmodules": "file-type-git",
  dockerfile: "file-type-docker",
  license: "file-type-license",
  "license.md": "file-type-license",
  "license.txt": "file-type-license",
  ".env": "file-type-dotenv",
  ".eslintrc": "file-type-eslint",
  ".eslintrc.json": "file-type-eslint",
  ".eslintrc.js": "file-type-eslint",
  "eslint.config.js": "file-type-eslint",
  "eslint.config.ts": "file-type-eslint",
  "vite.config.ts": "file-type-vite",
  "vite.config.js": "file-type-vite",
};

/** 扩展名（小写）→ 图标 id */
const BY_EXT: Record<string, string> = {
  ts: "file-type-typescript",
  mts: "file-type-typescript",
  cts: "file-type-typescript",
  tsx: "file-type-reactts",
  js: "file-type-js-official",
  mjs: "file-type-js",
  cjs: "file-type-js",
  jsx: "file-type-reactjs",
  json: "file-type-json",
  jsonc: "file-type-json",
  md: "file-type-markdown",
  html: "file-type-html",
  css: "file-type-css",
  scss: "file-type-scss",
  sass: "file-type-sass",
  less: "file-type-less",
  vue: "file-type-vue",
  svelte: "file-type-svelte",
  py: "file-type-python",
  go: "file-type-go",
  rs: "file-type-rust",
  java: "file-type-java",
  kt: "file-type-kotlin",
  swift: "file-type-swift",
  c: "file-type-c",
  h: "file-type-cheader",
  cpp: "file-type-cpp",
  cc: "file-type-cpp",
  php: "file-type-php",
  rb: "file-type-ruby",
  sh: "file-type-shell",
  bash: "file-type-shell",
  zsh: "file-type-shell",
  ps1: "file-type-powershell",
  yaml: "file-type-yaml",
  yml: "file-type-yaml",
  toml: "file-type-toml",
  ini: "file-type-ini",
  xml: "file-type-xml",
  sql: "file-type-sql",
  graphql: "file-type-graphql",
  gql: "file-type-graphql",
  png: "file-type-image",
  jpg: "file-type-image",
  jpeg: "file-type-image",
  gif: "file-type-image",
  svg: "file-type-image",
  webp: "file-type-image",
  ico: "file-type-image",
  mp3: "file-type-audio",
  wav: "file-type-audio",
  flac: "file-type-audio",
  mp4: "file-type-video",
  mov: "file-type-video",
  webm: "file-type-video",
  zip: "file-type-zip",
  gz: "file-type-zip",
  tar: "file-type-zip",
  pdf: "file-type-pdf2",
  woff: "file-type-font",
  woff2: "file-type-font",
  ttf: "file-type-font",
  otf: "file-type-font",
  log: "file-type-log",
  txt: "file-type-text",
};

/** 返回文件名对应的完整 iconify 图标名（含 vscode-icons: 前缀） */
export function fileIconName(name: string): string {
  const lower = name.toLowerCase();
  if (BY_NAME[lower]) return PREFIX + BY_NAME[lower];
  const ext = lower.includes(".") ? lower.split(".").pop()! : "";
  return PREFIX + (BY_EXT[ext] ?? "default-file");
}

export function FileIcon({ name, dir, open, className }: { name: string; dir?: boolean; open?: boolean; className?: string }): React.JSX.Element {
  const icon = dir ? (open ? `${PREFIX}default-folder-opened` : `${PREFIX}default-folder`) : fileIconName(name);
  return <Iconify icon={icon} className={className ?? "size-4 shrink-0"} aria-hidden="true" />;
}
