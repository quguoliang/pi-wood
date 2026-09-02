/**
 * pi-wood 子代理接线（T6.2 · §7.5 S4）。
 *
 * 复用 vendored `pi-subagent`（goofansu in-process 路线）的编排内核，产出一个可注入
 * 桌面 `SdkAdapter.inlineExtensions` 的内联扩展，使父会话获得 `agent_start/wait/…` 等
 * 工具；关键点是：为 child session 自建 `sessionOptionsFactory`，把桌面的审批门
 * （`permissionGateExtension`）作为 host 注入的内联扩展塞进 child 的 resourceLoader，
 * 让子代理的 bash/edit/write 也必须过桌面审批策略（否则 = 审批旁路）。
 *
 * 与方案 §7.5 的偏差：未把 getPolicy/confirmViaRenderer 抽到 security/approval-io.ts，
 * 而是由调用方（engine-manager，二者本就在其作用域内）以闭包传入，避免搬动阻塞对话框
 * 基础设施（approval:acceptAll 同时触达 pendingApprovals 与 pendingUiRequests）带来的回归。
 */
import { getAgentDir, type InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  permissionGateExtension,
  type ApprovalPolicy,
} from "../security/approval-gate.ts";
import { createSubagentRuntime, type SubagentRuntime } from "./vendor/index.ts";
import { createHarnessRegistry } from "./vendor/harnesses/contract.ts";
import { createPiHarness } from "./vendor/harnesses/pi/harness.ts";
import { createPiSessionOptions } from "./vendor/harnesses/pi/agent.ts";
import { getAgentsDir } from "./vendor/agents.ts";

export interface CreateSubagentRuntimeOptions {
  /** 当前会话审批策略读取器（与主 adapter 同源）。 */
  getPolicy: () => ApprovalPolicy;
  /** 需确认时经渲染层 ApprovalCard 往返（与主 adapter 同一通道）。 */
  confirm: (title: string, message: string) => Promise<boolean>;
  /**
   * 可选：当前会话是否自动接受（T7.2 语义）。子代理首版默认跟随父策略、不自动放行，
   * 传 undefined 即 child 一律按策略询问。留接口给 §7.7 T6.3 落地后做继承。
   */
  isAutoAccept?: () => boolean;
  /** 子代理 profile 目录与凭据 agentDir。缺省用 Pi 全局 agentDir。 */
  agentDir?: string;
}

export interface SubagentRuntimeHandle {
  /** vendored 运行时（S5 生命周期回收用）。 */
  runtime: SubagentRuntime;
  /** 作为桌面 SdkAdapter 的内联扩展注入。 */
  inlineExtension: { name: string; factory: (pi: unknown) => void };
  /** 关窗/切项目/adapter.stop 时回收所有子代理会话。 */
  dispose: () => Promise<void>;
}

/**
 * 构建一个绑定了「桌面审批门 child」的子代理运行时 + 内联扩展。
 * 每个 SdkAdapter（每项目一次）持有一个；切项目时须 dispose 再重建。
 */
export function createPiWoodSubagentRuntime(
  options: CreateSubagentRuntimeOptions,
): SubagentRuntimeHandle {
  const agentDir = options.agentDir ?? getAgentDir();

  // 桌面审批门：child 的 tool_call 复用父策略 + 同一 ApprovalCard 通道。
  // permissionGateExtension 返回 {name, factory}，与 SDK InlineExtension 对象形态一致。
  const childGate = permissionGateExtension(
    options.getPolicy,
    options.confirm,
    options.isAutoAccept,
  ) as unknown as InlineExtension;

  // Pi harness：注入自定义 sessionOptionsFactory，镜像默认 child 装配但额外吃进 host 的
  // 内联扩展（审批门）。filterPiChildExtensions 仍在默认工厂内部生效 → 去掉 pi-subagent
  // 自身、防子代理再套子代理。
  const harness = createPiHarness({
    agentDir,
    sessionOptionsFactory: (context, resolvedModel, resolvedThinking, dir, signal) =>
      createPiSessionOptions(
        context,
        resolvedModel,
        resolvedThinking,
        dir ?? agentDir,
        signal,
        [childGate],
      ),
  });

  const runtime = createSubagentRuntime({
    agentsDir: getAgentsDir(agentDir),
    harnesses: createHarnessRegistry([harness]),
  });

  return {
    runtime,
    inlineExtension: {
      name: "piwood-subagent",
      factory: (pi: unknown) => runtime.attach(pi as Parameters<SubagentRuntime["attach"]>[0]),
    },
    dispose: async () => {
      // 与 session-lifecycle.sessionShutdown 等价的显式回收：先关子代理适配器
      // （标 closed + 转发在飞 Run 取消），再清投递队列。best-effort，勿抛。
      try {
        await runtime.subagents.shutdown();
      } catch {
        /* ignore */
      }
      try {
        runtime.delivery.shutdown();
      } catch {
        /* ignore */
      }
    },
  };
}
