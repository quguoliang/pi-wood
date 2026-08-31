// T0.2 探针：验证 Pi SDK 装配路径（执行计划 T0.2）
// 用法：node scratch/sdk-probe.mjs "把 test.txt 里的 foo 改成 bar"
// 前置：模型凭据（环境变量 ANTHROPIC_API_KEY 等，或 ~/.pi/agent/auth.json）
// v0.84.4 实测装配路径（比在线文档精确，已记入执行计划 §8）：
//   createAgentSessionServices({cwd}) → createAgentSessionFromServices({services, sessionManager})
//   → createAgentSessionRuntime(factory, {cwd, agentDir, sessionManager})
//   factory 在每次 newSession/switchSession/fork 时按目标 cwd 重建 cwd 绑定服务。
import {
  createAgentSessionServices,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  SessionManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectCwd = resolve(here, "test-project");
const agentDir = getAgentDir();
const logPath = resolve(here, "../docs/proofs/T0.2/events-log.txt");
mkdirSync(resolve(here, "../docs/proofs/T0.2"), { recursive: true });

const log = (line) => {
  console.log(line);
  appendFileSync(logPath, line + "\n");
};

log(`[${new Date().toISOString()}] agentDir=${agentDir} cwd=${projectCwd}`);

// runtime 工厂：按目标 cwd 重建服务（EngineAdapter SdkAdapter 的核心结构）
let lastServices;
const runtimeFactory = async (opts) => {
  const services = await createAgentSessionServices({ cwd: opts.cwd, agentDir: opts.agentDir });
  const result = await createAgentSessionFromServices({
    services,
    sessionManager: opts.sessionManager,
  });
  lastServices = services;
  return { ...result, services, diagnostics: services.diagnostics };
};

log("building runtime (services → fromServices → runtime)...");
const sessionManager = SessionManager.create(projectCwd);
const runtime = await createAgentSessionRuntime(runtimeFactory, {
  cwd: projectCwd,
  agentDir,
  sessionManager,
});
const session = runtime.session;
log(`runtime ok: session=${!!session} newSession=${typeof runtime.newSession} switchSession=${typeof runtime.switchSession} fork=${typeof runtime.fork}`);
log(`sessionFile: ${session.sessionFile}`);

const events = [];
session.subscribe((event) => {
  events.push(event);
  const brief =
    event.type === "message_update"
      ? `${event.type}(${event.assistantMessageEvent?.type ?? "?"})`
      : event.type === "tool_execution_start"
        ? `${event.type}: ${event.toolName}`
        : event.type;
  log(`EVENT ${brief}`);
});

// T0.3：桌面 ctx.ui 桥（最小实现）——Node 下 notify 打日志，Electron 内换成 webContents.send
// 桌面模式语义 = "rpc"：阻塞式对话框（select/confirm/input）经 IPC 往返渲染层
const uiContext = {
  notify: (message, type) => log(`UI_NOTIFY[${type ?? "info"}] ${message}`),
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
await session.bindExtensions({ uiContext, mode: "rpc" });
log("bindExtensions ok (mode=rpc, desktop ui bridge bound)");

const prompt = process.argv[2];
if (!prompt) {
  log("NO_PROMPT_ARG: 无 Key 冒烟通过（runtime 装配 + 事件订阅就绪），未发送 prompt。");
  process.exit(0);
}

// 选择模型：getAvailable() 全量取回后按 provider 过滤
// （实测 getAvailable(providerId) 直传参数会返回空，语义不是按 provider 过滤——记入执行计划 §8）
const modelId = process.argv[3]; // 可选，如 deepseek-chat
const providerId = modelId?.includes("/") ? modelId.split("/")[0] : (process.env.PI_PROBE_PROVIDER ?? "deepseek");
const allAvailable = await lastServices.modelRuntime.getAvailable();
const available = allAvailable.filter((m) => m.provider === providerId);
log(`available models for ${providerId}: ${available.map((m) => m.id).join(", ") || "(none)"}`);
if (available.length === 0) {
  log("NO_MODEL: 该 Provider 无可用模型（检查 models.json / apiKey）");
  process.exit(1);
}
const chosen = modelId?.includes("/") ? available.find((m) => m.id === modelId.split("/")[1]) : (available.find((m) => m.id === modelId) ?? available[0]);
await session.setModel(chosen);
log(`MODEL: ${chosen.provider}/${chosen.id}`);

log(`PROMPT: ${prompt}`);
try {
  await session.prompt(prompt);
} catch (err) {
  log(`PROMPT_ERROR: ${err?.message ?? err}`);
  process.exit(1);
}
log(`DONE: ${events.length} events captured`);
