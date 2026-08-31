import { ipcMain } from "electron";
import { z } from "zod";

/**
 * 终端服务（T2.3，方案 §10.2）：
 * - @lydell/node-pty（N-API 预编译，无 ABI 重建负担，§8 决策）
 * - 每个终端一个 id；输出经 term:onData 推送渲染层 xterm，输入经 term:write 回写
 * - agent bash 与用户终端解耦；"镜像"由渲染层消费 bash_execution_update 实现
 */
interface PtySession {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  cwd: string;
}

const sessions = new Map<string, PtySession>();
let seq = 0;

const CreateArgSchema = z.object({
  cwd: z.string().min(1),
  shell: z.enum(["powershell", "cmd", "git-bash"]).optional(),
  cols: z.number().int().min(10).max(500).optional(),
  rows: z.number().int().min(5).max(200).optional(),
});
const SizeArgSchema = z.object({ id: z.string(), cols: z.number().int(), rows: z.number().int() });
const IdArgSchema = z.object({ id: z.string() });
const WriteArgSchema = z.object({ id: z.string(), data: z.string() });

function resolveShell(preferred?: string): { file: string; args: string[] } {
  if (preferred === "cmd") return { file: "cmd.exe", args: [] };
  if (preferred === "git-bash") {
    const root = process.env["ProgramFiles"] ?? "C:\\Program Files";
    return { file: `${root}\\Git\\bin\\bash.exe`, args: ["-i", "-l"] };
  }
  return { file: "powershell.exe", args: ["-NoLogo"] };
}

export function initTerminalIpc(send: (channel: string, data: unknown) => void): void {
  ipcMain.handle("term:create", async (_e, raw: unknown) => {
    const { cwd, shell, cols = 100, rows = 30 } = CreateArgSchema.parse(raw ?? {});
    const pty = await import("@lydell/node-pty");
    const { file, args } = resolveShell(shell);
    const id = `term-${++seq}`;
    const p = pty.spawn(file, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: process.env as Record<string, string>,
    });
    p.onData((data: string) => send("term:onData", { id, data }));
    p.onExit(({ exitCode }: { exitCode: number }) => {
      send("term:onExit", { id, exitCode });
      sessions.delete(id);
    });
    sessions.set(id, {
      cwd,
      write: (data) => p.write(data),
      resize: (c, r) => {
        try {
          p.resize(c, r);
        } catch {
          /* 已退出的 pty resize 会抛，忽略 */
        }
      },
      kill: () => p.kill(),
    });
    return id;
  });

  ipcMain.handle("term:write", (_e, raw: unknown) => {
    const { id, data } = WriteArgSchema.parse(raw);
    const s = sessions.get(id);
    if (!s) throw new Error(`terminal not found: ${id}`);
    s.write(data);
    return true;
  });

  ipcMain.handle("term:resize", (_e, raw: unknown) => {
    const { id, cols, rows } = SizeArgSchema.parse(raw);
    sessions.get(id)?.resize(cols, rows);
    return true;
  });

  ipcMain.handle("term:kill", (_e, raw: unknown) => {
    const { id } = IdArgSchema.parse(raw);
    const s = sessions.get(id);
    if (s) {
      s.kill();
      sessions.delete(id);
    }
    return true;
  });
}

export function killAllTerminals(): void {
  for (const s of sessions.values()) s.kill();
  sessions.clear();
}
