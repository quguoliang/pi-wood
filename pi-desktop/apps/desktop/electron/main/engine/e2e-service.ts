import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { app, ipcMain } from "electron";
import { diffLines } from "diff";

/**
 * T0.6 门禁端到端演示：Electron 内 "用 Pi 改一个文件" → 工具卡片 + diff 上屏。
 * 启动：electron . --probe-e2e（需 DEEPSEEK_API_KEY）
 * 说明：本文件为门禁临时装配（最简实现），T1.1 将重构为正式 EngineAdapter + IPC 层。
 */
export function isE2EMode(): boolean {
  return process.argv.includes("--probe-e2e");
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRec = Record<string, any>;

const E2E_CWD = join(app.getAppPath(), "scratch", "test-project");

function snapshotDir(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name === ".pi" || name === "node_modules" || name === ".git") continue;
        walk(full);
      } else {
        try {
          out.set(relative(root, full), readFileSync(full, "utf-8"));
        } catch {
          /* binary/locked file 忽略 */
        }
      }
    }
  };
  walk(root);
  return out;
}

export function startE2E(send: (channel: string, data: unknown) => void): void {
  void (async () => {
    const logFile = join(app.getAppPath(), "docs", "proofs", "T0.6", "e2e.log");
    mkdirSync(dirname(logFile), { recursive: true });
    const log = (line: string): void => {
      appendFileSync(logFile, line + "\n");
    };

    const {
      createAgentSessionServices,
      createAgentSessionFromServices,
      createAgentSessionRuntime,
      SessionManager,
      getAgentDir,
    }: any = await import("@earendil-works/pi-coding-agent");

    const fwd = (evt: AnyRec): void => {
      if (evt.type !== "message_update") log(`FWD ${evt.type}${evt.toolName ? `:${evt.toolName}` : ""}`);
      send("engine:event", evt);
    };

    try {
      const before = snapshotDir(E2E_CWD);
      const runtimeFactory = async (opts: { cwd: string; agentDir: string; sessionManager: any }) => {
        const services: any = await createAgentSessionServices({ cwd: opts.cwd, agentDir: opts.agentDir });
        const result: any = await createAgentSessionFromServices({
          services,
          sessionManager: opts.sessionManager,
        });
        return { ...result, services, diagnostics: services.diagnostics };
      };
      const runtime: any = await createAgentSessionRuntime(runtimeFactory, {
        cwd: E2E_CWD,
        agentDir: getAgentDir(),
        sessionManager: SessionManager.create(E2E_CWD),
      });
      const session: any = runtime.session;
      log(`e2e runtime ok cwd=${E2E_CWD}`);

      session.bindExtensions({
        uiContext: {
          notify: (message: string, type?: string) => send("ui:notify", { message, type: type ?? "info" }),
          select: async () => undefined,
          confirm: async () => false,
          input: async () => undefined,
          onTerminalInput: () => () => {},
          setStatus: () => {},
          setWorkingMessage: () => {},
          setWorkingVisible: () => {},
          setWorkingIndicator: () => {},
          setHiddenThinkingLabel: () => {},
          setWidget: () => {},
          setFooter: () => {},
        },
        mode: "rpc",
      });

      session.subscribe((event: AnyRec) => {
        fwd(event);
      });

      const allAvailable: AnyRec[] = await runtime.services.modelRuntime.getAvailable();
      const preferred = ["deepseek-chat", "deepseek-v4-flash", "deepseek-v4-pro"];
      const model =
        allAvailable.find((m) => m.provider === "deepseek" && preferred.includes(m.id)) ??
        allAvailable.find((m) => m.provider === "deepseek");
      if (!model) throw new Error("deepseek 无可用模型");
      await session.setModel(model);
      log(`model: deepseek/${model.id}`);

      // 暴露手动 prompt 入口（渲染层输入框用）
      ipcMain.removeHandler("engine:prompt");
      ipcMain.handle("engine:prompt", (_e, text: string) => session.prompt(text));

      log("auto prompt: 把 test.txt 里的 hello 改成 hola");
      await session.prompt("把 test.txt 里的 hello 改成 hola");

      // diff：前后快照对比
      const after = snapshotDir(E2E_CWD);
      for (const [file, content] of after) {
        const prev = before.get(file);
        if (prev !== undefined && prev !== content) {
          const patch = diffLines(prev, content)
            .map((part) => (part.added ? "+ " : part.removed ? "- " : "  ") + part.value)
            .join("");
          log(`DIFF ${file}\n${patch}`);
          send("engine:diff", { file, patch });
        }
      }
      log("E2E_RESULT: PASS");
      send("e2e:done", { ok: true });
      setTimeout(() => app.quit(), 3000);
    } catch (err) {
      log(`E2E_RESULT: FAIL — ${err instanceof Error ? err.message : String(err)}`);
      send("e2e:done", { ok: false, error: String(err) });
      setTimeout(() => app.quit(), 3000);
    }
  })();
}
