import { app } from "electron";
import type { PluginStatus } from "@pi-wood/ipc-schema";
import { PluginHost, type PluginHostServices } from "./plugin-host.ts";

/**
 * T5.2 插件宿主 headless 探针（仿 e2e-service 风格）。
 *
 * 不创建窗口、不加载引擎/Pi，只真起 utilityProcess 沙箱跑内置示例插件，断言两条验收硬指标：
 *  ① 未声明权限的 API 调用被拒（demo-overreach 调 terminal.run/diff.revert → activity 'denied'）
 *  ② 插件崩溃不杀主进程、自动重启回到 running（demo-crash 收控制消息 process.crash() → restarts≥1 且 running）
 *
 * 触发：electron out/main/index.js --plugin-probe   （或 dev: electron-vite dev -- --plugin-probe）
 * 退出码：全部通过 0，否则 1。
 */
export function isPluginProbeMode(): boolean {
  return process.argv.includes("--plugin-probe");
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs: number, intervalMs = 150): Promise<boolean> {
  const t0 = Date.now();
  for (;;) {
    if (pred()) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(intervalMs);
  }
}

function find(host: PluginHost, id: string): PluginStatus | undefined {
  return host.statusList().find((s) => s.id === id);
}

function line(tag: string, msg: string): void {
  console.log(`[plugin-probe] ${tag} ${msg}`);
}

export async function runPluginProbe(): Promise<void> {
  const logs: string[] = [];
  const services: PluginHostServices = {
    appPath: app.getAppPath(),
    sendToRenderer: () => {}, // 探针直接读 host.statusList()，无需渲染层
    getProjectDir: () => undefined,
    ui: {
      notify: (m, t) => {
        logs.push(`notify[${t ?? "info"}] ${m}`);
        line("·", m);
      },
      confirm: async () => true,
      select: async () => undefined,
      input: async () => undefined,
    },
    window: { setTitle: () => {}, setProgress: () => {} },
    browser: { navigate: async () => {}, screenshot: async () => "" },
    invokeAgentTool: async () => ({ ok: false, note: "probe" }),
    getEnabledMap: () => ({}), // 缺省全部启用（含三个示例插件）
    persistEnabled: () => {},
  };

  const host = new PluginHost(services);
  let pass = false;
  try {
    line(">", `appPath=${services.appPath}`);
    host.loadAndStart();

    // 先等三个示例插件 ready→running
    await waitFor(() => {
      const a = find(host, "demo-overreach");
      const b = find(host, "demo-crash");
      return a?.status === "running" && b?.status === "running";
    }, 6000);
    line(">", `启动后状态: overreach=${find(host, "demo-overreach")?.status} crash=${find(host, "demo-crash")?.status} kitchen=${find(host, "demo-kitchen")?.status}`);

    // ① 越权被拒：demo-overreach 激活 ~1.2s 后自试 terminal.run；也应看到 kitchen 的 terminal.run 被拒
    const denied = await waitFor(
      () => (find(host, "demo-overreach")?.activity ?? []).some((a) => a.kind === "denied" && /terminal:run/.test(a.text)),
      9000,
    );
    const overreach = find(host, "demo-overreach");
    line("①", `越权拒绝 = ${denied ? "PASS" : "FAIL"}（demo-overreach activity: ${JSON.stringify((overreach?.activity ?? []).filter((a) => a.kind === "denied").map((a) => a.text))}）`);

    // ② 崩溃 → 自动重启回 running：主动下发 crash 控制
    host.demo("crash");
    const sawDown = await waitFor(() => {
      const s = find(host, "demo-crash")?.status;
      return s === "restarting" || s === "crashed";
    }, 6000);
    const cameBack = await waitFor(() => {
      const st = find(host, "demo-crash");
      return !!st && st.restarts >= 1 && st.status === "running";
    }, 12000);
    const crash = find(host, "demo-crash");
    line("②", `崩溃检测=${sawDown ? "PASS" : "FAIL"}；重启回 running=${cameBack ? "PASS" : "FAIL"}（demo-crash restarts=${crash?.restarts} status=${crash?.status} lastError=${JSON.stringify(crash?.lastError ?? "")}）`);

    pass = denied && sawDown && cameBack;
    line("=", `主进程存活确认：探针进程仍在跑、utilityProcess 崩溃未波及主进程；结论 ${pass ? "ALL PASS" : "FAIL"}`);
  } catch (e) {
    line("!", `探针异常：${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    pass = false;
  } finally {
    try {
      host.stopAll();
    } catch {
      /* 清理忽略 */
    }
  }
  await sleep(300);
  app.exit(pass ? 0 : 1);
}
