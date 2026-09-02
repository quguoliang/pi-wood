// ensure-electron.mjs — Electron 二进制自愈脚本（pi-wood 固定流程，见 执行计划 §8 T0.1 偏差记录）
// 背景：pnpm 在依赖变动时会新建 .pnpm/electron@<ver>[_peers]/ 链接并（因 --ignore-scripts 或网络/解压故障）
// 留下无 dist/ 的空壳 → electron-vite 报 "Electron uninstall"。
// 本脚本在 dev/build 前校验当前解析到的 electron 目录，缺失时按序自愈：
//   1) 从任一含完整 dist 的同版本 .pnpm 兄弟目录复制；
//   2) 从 %LOCALAPPDATA%/electron/Cache 里的 win32-x64 zip 用 PowerShell Expand-Archive 解压
//      （extract-zip 在本机对 electron zip 静默失败，不可依赖）；
//   3) 都不行则报错并给出镜像下载指引。
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "apps/desktop/placeholder.js"));

const pkgDir = dirname(require.resolve("electron/package.json"));
const version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;
const binaryRel =
  process.platform === "win32"
    ? "electron.exe"
    : process.platform === "darwin"
      ? join("Electron.app", "Contents", "MacOS", "Electron")
      : "electron";
const exe = join(pkgDir, "dist", binaryRel);

if (existsSync(exe)) {
  process.exit(0);
}
console.warn(`[ensure-electron] ${exe} missing, repairing...`);

if (process.platform !== "win32") {
  // 自愈（缓存 zip + Expand-Archive）是 Windows 专用；非 win 平台直接给下载指引。
  console.error(
    `[ensure-electron] Electron binary not found for ${process.platform}. Download it:\n` +
    `  cd ${pkgDir} && node install.js`,
  );
  process.exit(1);
}

const pnpmDir = join(root, "node_modules/.pnpm");
// 1) 同版本兄弟目录里找完整 dist
const sibling = readdirSync(pnpmDir).find(
  (name) => name.startsWith(`electron@${version}`) && join(pnpmDir, name, "node_modules/electron/dist") !== join(pkgDir, "dist") && existsSync(join(pnpmDir, name, "node_modules/electron/dist", binaryRel)),
);
if (sibling) {
  cpSync(join(pnpmDir, sibling, "node_modules/electron/dist"), join(pkgDir, "dist"), { recursive: true });
} else {
  // 2) 缓存 zip 手动解压
  const cacheDirs = [
    join(process.env.LOCALAPPDATA ?? "", "electron/Cache"),
    join(process.env.LOCALAPPDATA ?? "", "electron-builder/Cache/electron"),
  ].filter((d) => d && existsSync(d));
  const findZip = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) { const hit = findZip(p); if (hit) return hit; }
      else if (entry.name === `electron-v${version}-win32-x64.zip`) return p;
    }
    return undefined;
  };
  const zip = cacheDirs.map(findZip).find(Boolean);
  if (!zip) {
    console.error(
      `[ensure-electron] No cached zip found. Download it first:\n` +
      `  cd ${join(pkgDir)} && ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node install.js\n` +
      `then re-run this script (extract-zip 静默失败时手动 Expand-Archive 缓存 zip 到 dist/).`,
    );
    process.exit(1);
  }
  execSync(`powershell.exe -NoProfile -Command "Expand-Archive -Path '${zip}' -DestinationPath '${join(pkgDir, "dist")}' -Force"`, { stdio: "inherit" });
}
// path.txt 必须无换行（echo 会带 \n 导致 spawn ENOENT，§8 T0.1）
writeFileSync(join(pkgDir, "path.txt"), "electron.exe");
if (!existsSync(exe)) {
  console.error("[ensure-electron] repair failed, binary still missing:", exe);
  process.exit(1);
}
console.warn(`[ensure-electron] repaired electron@${version} at ${pkgDir}`);
