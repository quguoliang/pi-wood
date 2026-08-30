import { spawn } from "node:child_process";

/**
 * T0.5 结论落地（见执行计划 §8）：
 * - node-pty 原版/预编译分支在无 VS Build Tools 的机器上都会回退源码编译 → 失败
 * - 采用 @lydell/node-pty（N-API 预编译，可选依赖分发 win32-x64 二进制），
 *   无需 electron-rebuild，Node 与 Electron 运行时均已实测通过 ConPTY spawn
 * - T2.3 终端面板直接基于本模块封装 pty 池；此处仅留接口占位
 */
export interface PtySpawnOptions {
  cwd: string;
  shell?: string;
  cols?: number;
  rows?: number;
}

export const PTY_MODULE = "@lydell/node-pty";

export function resolveShell(preferred?: string): { file: string; args: string[] } {
  if (preferred === "cmd") return { file: "cmd.exe", args: [] };
  if (preferred === "powershell" || !preferred) {
    return { file: "powershell.exe", args: ["-NoLogo"] };
  }
  // git-bash：由调用方配置安装路径；此处给常见默认
  if (preferred === "git-bash") {
    return { file: `${process.env["ProgramFiles"] ?? "C:\\Program Files"}\\Git\\bin\\bash.exe`, args: ["-i", "-l"] };
  }
  return { file: preferred, args: [] };
}

// 防止 tree-shake 后误以为未使用：显式导出 spawn 供 T2.3 使用
export const childProcessSpawn = spawn;
