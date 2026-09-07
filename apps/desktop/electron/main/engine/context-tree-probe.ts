import { app } from "electron";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineEvent, HostToolResult } from "@pi-wood/ipc-schema";
import { ALL_HOST_TOOL_SPECS } from "../agent-tools/host-tool-specs";
import {
  configureCapabilities,
  ensureConversation,
  shutdownAllConversations,
} from "./conversation-registry";
import { loadSessionMessages, openSessionTree, type SessionTreeRow } from "./session-service.ts";

/**
 * T9.2 上下文缩略树 v2 headless 探针（无模型、无窗口）：
 * 用**手工构造的带分叉会话 jsonl**（严格贴 Pi session-format：header + entry id/parentId 链）
 * 断言主进程侧三块底座——
 *   A1 树行投影（openSessionTree：role/textHead 题面、默认叶=时间戳最新末梢、activeBranch 只标路径）
 *   A2/A3 transcript 按叶过滤（loadSessionMessages(file, leafId)：旁支文本消失、两分支各得其所）
 *   A4 坏 leafId 降级为不过滤（宁可多显示，不可把历史清没）
 *   A5 navigateTree 帧契约（ENGINE_RPC_PARAM_SCHEMAS 已登记、参数校验通过/拒绝形状）
 *   B  真引擎 child 活链路：ensureConversation 起 child → switchSession 进 fixture →
 *      navigateTree 的 editorText 回填/assistant 目标不回填/零写盘三条断言（不碰模型）
 * 触发：electron . --context-tree-probe   （EXIT 0=全过 / 1=失败）
 */
export function isContextTreeProbeMode(): boolean {
  return process.argv.includes("--context-tree-probe");
}

const line = (tag: string, msg: string): void => console.log(`[context-tree-probe] ${tag} ${msg}`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** ISO 时间戳生成器：base + n 分钟，保证严格单调（默认叶=最后写入的末梢） */
const ts = (n: number): string => new Date(Date.UTC(2026, 8, 7, 0, 0, 0) + n * 60_000).toISOString();

/** B 组要起真 child：capabilities 全桩（不接渲染层，审批一律拒 = deny-by-default，事件只吞不记） */
function installStubCaps(): void {
  configureCapabilities({
    hostToolNames: () => ALL_HOST_TOOL_SPECS.map((s) => s.name),
    additionalExtensionPaths: () => [],
    executeHostTool: async (p): Promise<HostToolResult> => ({
      content: [{ type: "text", text: `probe-host:${p.name}` }],
      details: { ok: true },
    }),
    requestUi: async () => undefined,
    decideApproval: async () => ({ allow: false, reason: "探针无渲染层，一律拒绝（deny-by-default）" }),
    onSubagent: () => undefined,
    onEngineEvent: (_ctx, _event: EngineEvent) => undefined,
    notify: () => undefined,
    maxLiveEngines: () => 2,
    maxRestarts: () => 0,
  });
}

interface FxEntry {
  type: "message";
  id: string;
  parentId: string | null;
  timestamp: string;
  message: Record<string, unknown>;
}

const user = (id: string, parentId: string | null, n: number, text: string): FxEntry => ({
  type: "message", id, parentId, timestamp: ts(n), message: { role: "user", content: text },
});
const assistant = (id: string, parentId: string | null, n: number, text: string): FxEntry => ({
  type: "message", id, parentId, timestamp: ts(n), message: { role: "assistant", content: [{ type: "text", text }] },
});
const toolResult = (id: string, parentId: string | null, n: number, toolName: string): FxEntry => ({
  type: "message", id, parentId, timestamp: ts(n),
  message: { role: "toolResult", toolCallId: `call-${id}`, toolName, content: [{ type: "text", text: "done" }], isError: false },
});

export async function runContextTreeProbe(): Promise<void> {
  const results: Array<{ pass: boolean; name: string; detail: string }> = [];
  const check = (name: string, pass: boolean, detail: string): void => {
    results.push({ name, pass, detail });
    line(pass ? "✓" : "✗", `${name} — ${detail}`);
  };

  try {
    const dir = mkdtempSync(join(tmpdir(), "pi-wood-ctx-tree-probe-"));
    const file = join(dir, "session.jsonl");
    // 拓扑：header → u1 → a1 →（主干 u2 → a2 → t2）＋（旁支 ub → ab），旁支时间最新 = 默认叶
    const header = { type: "session", version: 3, id: "sess-probe1", timestamp: ts(0), cwd: dir };
    const entries: FxEntry[] = [
      user("e00000u1", "sess-probe1", 1, "第一个问题"),
      assistant("e0000a11", "e00000u1", 2, "第一个回答"),
      user("e00000u2", "e0000a11", 3, "主干追问"),
      toolResult("e0000t21", "e00000u2", 4, "bash"),
      assistant("e0000a21", "e0000t21", 5, "主干回答"),
      user("e00000ub", "e0000a11", 6, "换个思路的旁支问题"),
      assistant("e0000ab1", "e00000ub", 7, "旁支回答"),
    ];
    writeFileSync(file, [header, ...entries].map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");

    // A1：树行投影
    const tree = await openSessionTree(file);
    const rowOf = (id: string): SessionTreeRow | undefined => tree.rows.find((r) => r.id === id);
    check(
      "A1.1 默认叶=时间戳最新末梢（旁支尾 ab）",
      tree.defaultLeafId === "e0000ab1",
      `defaultLeafId=${tree.defaultLeafId ?? "-"}`,
    );
    check(
      "A1.2 activeBranch 只标默认路径（旁支在路径上、主干不在）",
      rowOf("e00000u2")?.activeBranch === false && rowOf("e0000ab1")?.activeBranch === true,
      `u2=${rowOf("e00000u2")?.activeBranch} ab=${rowOf("e0000ab1")?.activeBranch}`,
    );
    check(
      "A1.3 题面投影：user 文本 / assistant 文本 / tool 工具名",
      rowOf("e00000ub")?.role === "user" &&
        rowOf("e00000ub")?.textHead === "换个思路的旁支问题" &&
        rowOf("e0000ab1")?.role === "assistant" &&
        rowOf("e0000t21")?.role === "tool" &&
        rowOf("e0000t21")?.textHead === "bash",
      `ub=${JSON.stringify(rowOf("e00000ub")?.textHead)} t=${rowOf("e0000t21")?.role}/${rowOf("e0000t21")?.textHead}`,
    );

    // A2/A3：transcript 按叶过滤
    const branchMsgs = await loadSessionMessages(file, "e0000ab1");
    const branchTexts = branchMsgs.map((m) => m.text).join("|");
    check(
      "A2 旁枝叶过滤：只剩 root→旁支路径，主干文本消失",
      branchMsgs.length === 4 && !branchTexts.includes("主干") && branchTexts.includes("换个思路的旁支问题"),
      `n=${branchMsgs.length} texts=${branchTexts}`,
    );
    const mainMsgs = await loadSessionMessages(file, "e0000a21");
    const mainTexts = mainMsgs.map((m) => m.text).join("|");
    check(
      "A3 主干枝叶过滤：含追问+工具+回答、不含旁支",
      mainMsgs.length === 5 && mainTexts.includes("主干追问") && mainMsgs.some((m) => m.role === "tool" && m.toolName === "bash") && !mainTexts.includes("换个思路"),
      `n=${mainMsgs.length}`,
    );

    // A4：坏 leafId 降级不过滤（防御语义）
    const fallback = await loadSessionMessages(file, "ffffffff");
    const all = await loadSessionMessages(file);
    check(
      "A4 未知 leafId 降级=不过滤（历史不清空）",
      fallback.length === all.length && fallback.length === 7,
      `fallback=${fallback.length} all=${all.length}`,
    );

    // A5：navigateTree 帧契约（engine-rpc 参数校验：正例过、缺 targetId 拒）
    const { validateRpcParams } = await import("@pi-wood/ipc-schema");
    const okFrame = validateRpcParams("navigateTree", { targetId: "e00000ub", summarize: false });
    const badFrame = validateRpcParams("navigateTree", { summarize: false });
    check(
      "A5 navigateTree RPC 帧契约（targetId 必填）",
      okFrame.ok === true && badFrame.ok === false,
      `ok=${okFrame.ok} bad=${badFrame.ok}`,
    );

    // A6（T9.2 v2.1）：createBranchedSession——「从某条消息另开新对话」的文件底座：
    // 新会话文件只含 root→指定叶 的路径，旁支之外的条目整体消失。
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    const branchDir = mkdtempSync(join(tmpdir(), "piwood-ctx-tree-branch-"));
    const a6File = SessionManager.open(file, branchDir).createBranchedSession("e0000ab1");
    const branchOk = Boolean(a6File) && existsSync(a6File as string);
    const a6Msgs = branchOk ? await loadSessionMessages(a6File as string) : [];
    const branchJoin = a6Msgs.map((m) => m.text).join("|");
    check(
      "A6.1 分支会话文件生成且只含 root→旁支路径",
      branchOk && a6Msgs.length === 4 && branchJoin.includes("换个思路的旁支问题") && !branchJoin.includes("主干"),
      `file=${a6File ? "ok" : "✗"} n=${a6Msgs.length}`,
    );
    const badBranch = (() => {
      try {
        return SessionManager.open(file, branchDir).createBranchedSession("ffffffff") ?? null;
      } catch {
        return "throws";
      }
    })();
    check("A6.2 未知 leaf 不产出脏文件（null 或抛错）", badBranch === null || badBranch === "throws", String(badBranch));

    // ---------- B：真引擎 child 活链路（switchSession → navigateTree，不碰模型） ----------
    installStubCaps();
    const projDir = mkdtempSync(join(tmpdir(), "piwood-ctx-tree-proj-"));
    writeFileSync(join(projDir, "README.md"), "# ctx-tree probe\n", "utf-8");
    const adapter = await ensureConversation(projDir);
    check("B0 引擎 child 起活并完成装配", Boolean(adapter), adapter ? `transport=${adapter.transportKind}` : "adapter 缺席");
    await adapter.switchSession(file);
    const sizeBefore = statSync(file).size;
    // B1 目标是 user 条目（旁支首问）：leaf 挪到其父 a1，原文回填
    const navUser = await adapter.navigateTree("e00000ub");
    check(
      "B1 navigateTree(user 条目) → editorText 回填旁支问题、未取消",
      navUser.cancelled === false && navUser.editorText === "换个思路的旁支问题",
      `editorText=${JSON.stringify(navUser.editorText ?? null)}`,
    );
    // B2 目标是主干 assistant 条目：leaf=条目本身、无回填
    const navAssistant = await adapter.navigateTree("e0000a21");
    check(
      "B2 navigateTree(assistant 条目) → 不回填、未取消（从这里继续聊）",
      navAssistant.cancelled === false && navAssistant.editorText === undefined,
      `editorText=${JSON.stringify(navAssistant.editorText ?? null)}`,
    );
    // B3 navigate 不截断不写盘（append-only 树的 leaf 只是内存指针）
    const sizeAfter = statSync(file).size;
    check("B3 navigateTree 零写盘（会话文件字节不变）", sizeBefore === sizeAfter, `${sizeBefore} → ${sizeAfter}`);
    await shutdownAllConversations();
  } catch (e) {
    check("异常", false, e instanceof Error ? e.stack ?? e.message : String(e));
  }

  const allPass = results.length > 0 && results.every((r) => r.pass);
  line("=", `${results.filter((r) => r.pass).length}/${results.length} 通过 · 结论 ${allPass ? "ALL PASS" : "FAIL"}`);
  await sleep(200);
  app.exit(allPass ? 0 : 1);
}
