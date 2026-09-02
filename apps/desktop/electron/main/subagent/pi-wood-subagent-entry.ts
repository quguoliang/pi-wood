/**
 * pi-wood 子代理接线入口（方案 1：SDK 托管的 ESM 扩展）。
 *
 * ⚠ 本文件【不】被 CJS 主进程静态 import、也不打进 out/main bundle —— 它由 SDK 的
 * jiti/ESM 管线在运行时经 `additionalExtensionPaths` 加载（`pi-wood` 引擎启动时传入）。
 * 因此它可安全地静态 `import` 那套 ESM-only 的 vendored 内核（`./vendor/**`，其内部又
 * import `@earendil-works/pi-coding-agent`/pi-tui/typebox，均由 SDK 的 jiti alias 解析），
 * `import.meta.url` 亦可用。child 审批门经 globalThis 桥从主进程取回（见 bridge.ts）。
 */
import { getAgentDir, type ExtensionAPI, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { createSubagentRuntime, type SubagentRuntime } from "./vendor/index.ts";
import { createHarnessRegistry } from "./vendor/harnesses/contract.ts";
import { createPiHarness } from "./vendor/harnesses/pi/harness.ts";
import { createPiSessionOptions } from "./vendor/harnesses/pi/agent.ts";
import { getAgentsDir } from "./vendor/agents.ts";
import type { PiWoodSubagentBridge } from "./bridge.ts";

// 单个进程生命周期内复用一个运行时（对齐上游 processRuntime 语义）。
let runtime: SubagentRuntime | undefined;

export default function piWoodSubagentExtension(pi: ExtensionAPI): void {
  const bridge: PiWoodSubagentBridge | undefined = globalThis.__piwoodSubagentBridge;
  // 主进程未挂桥（例如非桌面宿主直接跑该扩展）→ 本入口 inert，交回上游默认扩展自行处理。
  if (!bridge) return;

  if (!runtime) {
    // 入口在 ESM/jiti 世界，可安全取 SDK 的 getAgentDir（与桌面同一 ~/.pi/agent）。
    const agentDir = getAgentDir();
    // child 内联审批门来自桥（复用桌面 getPolicy + ApprovalCard confirm）→ 杜绝审批旁路。
    const childGate = bridge.buildChildGate() as unknown as InlineExtension;
    const harness = createPiHarness({
      agentDir,
      onRunEvent: (runId, event) => bridge.pushChildEvent?.(runId, event),
      sessionOptionsFactory: (context, resolvedModel, resolvedThinking, dir, signal) =>
        createPiSessionOptions(
          context,
          resolvedModel,
          resolvedThinking,
          dir ?? agentDir,
          signal,
          [childGate],
          bridge.guardChildTool,
        ),
    });
    runtime = createSubagentRuntime({
      agentsDir: getAgentsDir(agentDir),
      harnesses: createHarnessRegistry([harness]),
    });
    bridge.onRuntime(runtime as unknown as Parameters<PiWoodSubagentBridge["onRuntime"]>[0]);
  }
  runtime.attach(pi);
}
