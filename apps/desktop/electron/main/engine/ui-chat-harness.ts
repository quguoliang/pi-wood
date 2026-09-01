import { app, BrowserWindow } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ENGINE_CHANNELS } from "@pi-wood/ipc-schema";
import { ensureEngine } from "./engine-manager";

/**
 * dev 专用：真实对话端到端视觉测试台。走正式 engine-manager 链路（含快照/diff/模型选择），
 * 触发 read + write + bash 多类工具，agent_settled 后截屏并硬退出。
 * 启动：electron-vite dev -- --ui-chat <绝对路径.png>（需已配置模型密钥）
 *       electron-vite dev -- --ui-stress <绝对路径.png> <条数>（纯前端虚拟化压测）
 */
export function isUiChatMode(): boolean {
  return process.argv.includes("--ui-chat") || process.argv.includes("--ui-stress");
}

let started = false;

function capture(file: string): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  void win.webContents.capturePage().then((image) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, image.toPNG());
    console.log(`[ui-chat] captured ${file}`);
  });
}

/** 纯前端压测：注入 N 条 user_message 事件，验证 react-virtual 只渲染视口内行、不卡死。 */
function runStress(file: string, count: number): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  const t0 = Date.now();
  const payload = "压测消息 —— 这是一条较长的消息内容，用于测量虚拟化列表在超大数量下的渲染与内存表现。";
  for (let i = 0; i < count; i++) {
    win.webContents.send(ENGINE_CHANNELS.event, { type: "user_message", text: `${payload} #${i + 1}` });
  }
  console.log(`[ui-stress] sent ${count} events in ${Date.now() - t0}ms`);
  setTimeout(() => {
    capture(file);
    setTimeout(() => app.exit(0), 500);
  }, 1500);
}

export function runUiChat(): void {
  if (started) return;
  started = true;

  if (process.argv.includes("--ui-stress")) {
    const sIdx = process.argv.indexOf("--ui-stress");
    const file = process.argv[sIdx + 1] ?? join(app.getAppPath(), "docs", "proofs", "ui-v3", "ui-stress.png");
    const count = Number(process.argv[sIdx + 2] ?? "10000");
    setTimeout(() => runStress(file, count), 1500);
    return;
  }

  const idx = process.argv.indexOf("--ui-chat");
  const file = process.argv[idx + 1] ?? join(app.getAppPath(), "docs", "proofs", "ui-v3", "ui-chat.png");
  const cwd = join(app.getAppPath(), "scratch", "test-project");
  let finished = false;
  const finish = (code: number): void => {
    if (finished) return;
    finished = true;
    setTimeout(() => {
      capture(file);
      setTimeout(() => app.exit(code), 800);
    }, 400);
  };

  void (async () => {
    try {
      const adapter = await ensureEngine(cwd);
      adapter.subscribe((event) => {
        if (event.type === "agent_settled") finish(0);
      });
      await new Promise((r) => setTimeout(r, 1000));
      await adapter.prompt({
        text: "请用 read 工具分别读取 greet.js 和 README.md 两个文件，然后简要说明这个项目是做什么的、greet.js 提供了什么函数。",
      });
      setTimeout(() => finish(0), 120_000); // 硬上限兜底
    } catch (err) {
      console.error("[ui-chat] failed:", err);
      finish(1);
    }
  })();
}
