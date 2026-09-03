import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { app } from "electron";

/**
 * T0.3 Electron 主进程探针：验证 jiti 在 Electron 运行时加载 TS 扩展 + ctx.ui 桥。
 * 启动方式：electron . --probe-extensions（需 DEEPSEEK_API_KEY 环境变量）
 * 结果落盘 docs/proofs/T0.3/electron-probe.log 并同步发渲染层。
 */
export function isExtensionProbeMode(): boolean {
  return process.argv.includes("--probe-extensions");
}

export async function runExtensionProbe(send: (channel: string, data: unknown) => void): Promise<void> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  // T8.P 保留动态 import（非格式原因）：探针自带独立装配路径（不依赖引擎/sdk-adapter），
  // 便于单独验证「主进程内直接加载 Pi SDK」这一链路；Pi 静态与否不影响探针结论。
  const {
    createAgentSessionServices,
    createAgentSessionFromServices,
    createAgentSessionRuntime,
    SessionManager,
    getAgentDir,
  }: any = await import("@earendil-works/pi-coding-agent");

  const logFile = join(app.getAppPath(), "docs", "proofs", "T0.3", "electron-probe.log");
  mkdirSync(dirname(logFile), { recursive: true });
  const log = (line: string) => {
    appendFileSync(logFile, line + "\n");
    send("probe:log", line);
  };
  log(`[probe] env DEEPSEEK_API_KEY present: ${Boolean(process.env.DEEPSEEK_API_KEY)}`);
  const finish = (ok: boolean) => {
    appendFileSync(logFile, `PROBE_RESULT: ${ok ? "PASS" : "FAIL"}\n`);
    send("probe:done", { ok });
    setTimeout(() => app.quit(), 1500); // 留时间给渲染层 toast，然后自动退出
  };

  const cwd = join(app.getAppPath(), "scratch", "test-project");
  const agentDir = getAgentDir();
  log(`[probe] agentDir=${agentDir} cwd=${cwd}`);

  // 桌面 ctx.ui 桥：notify 直达渲染层 toast（阻塞式对话框 T1.x 接 Radix）
  const uiContext = {
    notify: (message: string, type?: "info" | "warning" | "error") =>
      send("ui:notify", { message, type: type ?? "info" }),
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
  };

  try {
    const runtimeFactory = async (opts: { cwd: string; agentDir: string; sessionManager: any }) => {
      const services: any = await createAgentSessionServices({ cwd: opts.cwd, agentDir: opts.agentDir });
      const result: any = await createAgentSessionFromServices({
        services,
        sessionManager: opts.sessionManager,
      });
      return { ...result, services, diagnostics: services.diagnostics };
    };

    const runtime: any = await createAgentSessionRuntime(runtimeFactory, {
      cwd,
      agentDir,
      sessionManager: SessionManager.create(cwd),
    });
    log("[probe] runtime ok（扩展经 DefaultResourceLoader 自动发现，jiti 在 Electron 主进程加载 TS 扩展成功）");

    await runtime.session.bindExtensions({ uiContext, mode: "rpc" });
    log("[probe] bindExtensions ok (mode=rpc)");

    runtime.session.subscribe((event: any) => {
      if (event.type === "tool_execution_start") log(`[probe] TOOL_START: ${event.toolName}`);
      if (event.type === "tool_execution_end")
        log(`[probe] TOOL_END: isError=${Boolean(event.isError)}`);
    });

    const allAvailable: Array<{ provider: string; id: string }> =
      await runtime.services.modelRuntime.getAvailable();
    const runtimeError: string | undefined = runtime.services.modelRuntime.getError();
    if (runtimeError) log(`[probe] modelRuntime error: ${runtimeError}`);
    log(
      `[probe] available(${allAvailable.length}): ${allAvailable.map((m) => `${m.provider}/${m.id}`).slice(0, 12).join(", ")}`,
    );
    // 模型兜底链：目录内容随在线刷新变化（chat 可能退役，v4 系是现役），能跑工具即可
    const preferred = ["deepseek-chat", "deepseek-v4-flash", "deepseek-v4-pro"];
    const model =
      allAvailable.find((m) => m.provider === "deepseek" && preferred.includes(m.id)) ??
      allAvailable.find((m) => m.provider === "deepseek");
    if (!model) throw new Error("deepseek 无可用模型（检查 DEEPSEEK_API_KEY）");
    await runtime.session.setModel(model);
    log("[probe] model set: deepseek/deepseek-chat");

    await runtime.session.prompt("用 echo_greeting 工具发送 electron-bridge-test");
    log("[probe] prompt 完成");
    finish(true);
  } catch (err) {
    log(`[probe] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    finish(false);
  }
}
