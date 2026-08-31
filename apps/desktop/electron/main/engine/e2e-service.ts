import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { app, ipcMain } from "electron";
import { diffLines } from "diff";
import { SdkAdapter } from "@pi-wood/engine/sdk";
import type { DesktopUiBridge } from "@pi-wood/engine";
import { ENGINE_CHANNELS, PromptCommandSchema } from "@pi-wood/ipc-schema";

/**
 * T0.6 门禁端到端演示（T1.1 重构版）：改用正式 SdkAdapter + IPC 契约通道。
 * 启动：electron . --probe-e2e（需 DEEPSEEK_API_KEY）
 * 说明：diff 快照对比仍为门禁占位实现，T2.2 正式化为 snapshot-service。
 */
export function isE2EMode(): boolean {
  return process.argv.includes("--probe-e2e");
}

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

    const uiBridge: DesktopUiBridge = {
      notify: (message, type) => send("ui:notify", { message, type: type ?? "info" }),
      select: async () => undefined,
      confirm: async () => false,
      input: async () => undefined,
    };

    const adapter = new SdkAdapter();
    try {
      const before = snapshotDir(E2E_CWD);

      await adapter.start({ projectDir: E2E_CWD, uiBridge });
      adapter.subscribe((event) => {
        if (event.type !== "message_update") log(`FWD ${event.type}`);
        if (event.type === "message_end") {
          const msg = (event as { message?: { content?: Array<{ type: string; text?: string }> } })
            .message;
          const texts = (msg?.content ?? [])
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join(" | ");
          if (texts) log(`ASSISTANT_TEXT: ${texts.slice(0, 300)}`);
          const toolCalls = (msg?.content ?? []).filter((c) => c.type === "toolCall" || c.type === "tool_call");
          if (toolCalls.length > 0) log(`ASSISTANT_TOOLCALLS: ${toolCalls.length}`);
        }
        send(ENGINE_CHANNELS.event, event);
      });
      log("e2e: SdkAdapter started");

      // 模型选择：chat 优先（工具调用稳定），v4 系兜底；setModel 直连不依赖目录列表（§8）
      const candidates: Array<[string, string]> = [
        ["deepseek", "deepseek-chat"],
        ["deepseek", "deepseek-v4-flash"],
        ["deepseek", "deepseek-v4-pro"],
      ];
      let chosen: [string, string] | undefined;
      let lastErr: unknown;
      for (const [p, id] of candidates) {
        try {
          await adapter.setModel(p, id);
          chosen = [p, id];
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!chosen) throw new Error(`deepseek 无可用模型: ${String(lastErr)}`);
      log(`model: ${chosen[0]}/${chosen[1]}`);

      // 命令通道：zod 校验入口（渲染层输入框）
      ipcMain.removeHandler(ENGINE_CHANNELS.prompt);
      ipcMain.handle(ENGINE_CHANNELS.prompt, (_e, raw: unknown) => {
        const cmd = PromptCommandSchema.parse(raw);
        return adapter.prompt(cmd);
      });

      log("auto prompt: 把 test.txt 里的 hello 改成 hola");
      await adapter.prompt({ text: "把 test.txt 里的 hello 改成 hola" });

      const after = snapshotDir(E2E_CWD);
      for (const [file, content] of after) {
        const prev = before.get(file);
        if (prev !== undefined && prev !== content) {
          const patch = diffLines(prev, content)
            .map((part) => (part.added ? "+ " : part.removed ? "- " : "  ") + part.value)
            .join("");
          log(`DIFF ${file}\n${patch}`);
          send(ENGINE_CHANNELS.diff, { file, patch });
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
