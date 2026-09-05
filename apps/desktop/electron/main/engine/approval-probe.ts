import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import { ENGINE_REVERSE_METHODS } from "@pi-wood/ipc-schema";
import { decide, type ApprovalPolicy } from "../security/approval-gate";
import { loadSettings, replaceSection } from "../settings-service";
import { getConversation, listConversations, setActiveConversation, shutdownAllConversations } from "./conversation-registry";
import {
  armPendingTimeoutsFor,
  decideApprovalFor,
  ensureEngine,
  pendingApprovalSnapshot,
  respondApprovalFor,
} from "./engine-manager";

/**
 * T8.4 安全底线探针 `electron . --approval-probe`（无窗、真 child、真裁决路径，app.exit(0/1)）。
 *
 * 立它的理由：T8.4 的三条安全验收此前只有**单测**与「stub 恒拒」——
 * `--conversation-probe` 里的 `decideApproval` 是探针自己装的假实现，它绿了只证明
 * 「宿主说拒、child 就拒」，**没有证明真主进程在没人应答时会自动拒**。
 * 本探针把断言打在真实实现上（`decideApprovalFor` / `respondApprovalFor` / 超时起表逻辑），
 * 并通过 `PIWOOD_APPROVAL_TIMEOUT_MS` 测试缝把 120s 窗口压到秒级，使「超时 = 拒」可判。
 *
 * 覆盖：
 *   D0 前置：把策略钉成 allAsk（跑完恢复），确认 `decide(...)==="ask"`——否则后面的断言全是空转
 *   D1 协议层无本地放行路径：反向通道只有四条，**不存在**任何让 child 自己读策略/自批的方法
 *   D2 端到端 deny-by-default：真 child 发 `host:approval`、无渲染层应答 → child 确实收到 `allow:false`
 *   D3 票据一次性：同一 ticket 第二次使用被拒（真实现，非纯函数单测）
 *   D4 应答者归属：跨对话应答被拒；切到发起对话后才允许
 *   D5 后台不静默拒：非 active 对话的 pending 在超时窗口后仍在且未起表；切过去起表后才落 deny
 */

const TIMEOUT_MS = 900;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const POLICY_TOOL = "bash"; // 非只读工具：allAsk 下必然进「问人」分支

function makeGitProject(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `piwood-appr-${tag}-`));
  writeFileSync(join(dir, "README.md"), `# ${tag}\n`, "utf-8");
  const run = (args: string[]): void => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  };
  run(["init", "-q"]);
  run(["config", "user.email", "probe@piwood.dev"]);
  run(["config", "user.name", "piwood-approval-probe"]);
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "base"]);
  return dir;
}

export function isApprovalProbeMode(): boolean {
  return process.argv.includes("--approval-probe");
}

export async function runApprovalProbe(): Promise<void> {
  // env 必须在 ensureEngine / 起表之前设好（超时值是**起表时**读的，不是模块常量）
  process.env.PIWOOD_ENGINE_PROBE = "1";
  process.env.PIWOOD_APPROVAL_TIMEOUT_MS = String(TIMEOUT_MS);

  const results: Array<{ name: string; ok: boolean; note: string }> = [];
  const check = (name: string, ok: boolean, note = ""): void => {
    results.push({ name, ok, note });
    console.log(`${ok ? "✓" : "✗"} ${name}${note ? ` — ${note}` : ""}`);
  };

  const savedPolicy = loadSettings().approval as ApprovalPolicy;
  const savedRules = loadSettings().approval.rules;
  console.log("=== T8.4 --approval-probe（deny-by-default / 票据 / 归属 / 后台不静默拒） ===");
  let code = 1;
  try {
    // D0 把策略钉成 allAsk（探针结束恢复），否则断言会随本机设置漂移
    replaceSection("approval", { mode: "allAsk", rules: savedRules ?? [] });
    const decision = decide(loadSettings().approval as ApprovalPolicy, POLICY_TOOL, { command: "echo probe" });
    check("D0 前置：策略已钉为 allAsk 且该工具确实要问人", decision === "ask", `decide(${POLICY_TOOL}) = ${decision}`);
    if (decision !== "ask") throw new Error("策略钉不住（decide 不是 ask），后续断言无意义");

    // D1 协议层：child 能借的能力清单里没有「自己读策略 / 自己放行」这类通道
    const forbidden = ENGINE_REVERSE_METHODS.filter((m) => /policy|allow|grant|approve|auto/i.test(m));
    check(
      "D1 反向通道无本地放行路径（清单封闭且不含策略读取类方法）",
      ENGINE_REVERSE_METHODS.length === 4 && forbidden.length === 0,
      ENGINE_REVERSE_METHODS.join(", "),
    );

    // 真 caps：走 engine-manager 的 ensureEngine（探针不建窗口，故宿主侧没人应答）
    const projA = makeGitProject("a");
    const projB = makeGitProject("b");
    await ensureEngine(projA);
    await ensureEngine(projA, { newConversation: true });
    await ensureEngine(projB);
    const rows = listConversations();
    const bg = rows.find((r) => r.projectDir === projA)!; // 故意留作「后台对话」（active 是最后建的那条）
    const active = rows[rows.length - 1]!;

    // D2 端到端：真 child 发 3 次 host:approval，无渲染层 → 每次都应拿到 allow:false（超时=拒）
    const t0 = Date.now();
    const echo = (await getConversation(active.id)?.host.invoke("debugEcho", { events: 0, approvals: 3, gapMs: 0 })) as {
      verdicts?: Array<{ allow: boolean; reason?: string }>;
    };
    const dur = Date.now() - t0;
    const verdicts = echo?.verdicts ?? [];
    check(
      "D2 端到端 deny-by-default：child 确实收到 allow:false（无人应答 → 超时拒）",
      verdicts.length === 3 && verdicts.every((v) => v.allow === false),
      `verdicts=${verdicts.map((v) => `${v.allow}${v.reason ? `(${v.reason.slice(0, 10)})` : ""}`).join(" ")}，耗时 ${dur}ms（3×${TIMEOUT_MS}ms 超时档，未挂死）`,
    );

    // D3 票据一次性（真实现）：同 ticket 第二次必须被拒，且理由指向票据
    const ticket = `probe-ticket-${Date.now()}`;
    const ctx = { conversationId: active.id, projectDir: active.projectDir };
    const first = await decideApprovalFor(ctx, { ticket, toolName: "write", input: { path: ".ssh/id_rsa" } });
    const second = await decideApprovalFor(ctx, { ticket, toolName: "bash", input: { command: "echo hi" } });
    check(
      "D3 票据一次性：同一 ticket 的第二次裁决被拒（防重放绕过）",
      first.allow === false && second.allow === false && /票据|ticket|重放/i.test(second.reason ?? ""),
      `#1 ${first.reason?.slice(0, 24)} / #2 ${second.reason?.slice(0, 24)}`,
    );

    // D4/D5 起一条真实 pending（后台对话发起，不 await）
    const pendingPromise = decideApprovalFor({ conversationId: bg.id, projectDir: bg.projectDir }, { ticket: `probe-pending-${Date.now()}`, toolName: POLICY_TOOL, input: { command: "echo pending" } });
    await sleep(60);
    const snap1 = pendingApprovalSnapshot().filter((p) => p.conversationId === bg.id);
    check("D4a 后台对话确实有一条在飞 pending（可被应答，而不是被忽略）", snap1.length === 1, `pending=${snap1.length}`);

    // D4 跨对话应答被拒：拿别人的 id 冒充应答
    const id = snap1[0]!.id;
    const wrongOwner = respondApprovalFor({ id, conversationId: active.id, allow: true });
    const stillThere = pendingApprovalSnapshot().some((p) => p.conversationId === bg.id);
    check(
      "D4b 跨对话应答被拒（应答者 ≠ 发起对话，且 pending 保留给发起对话）",
      wrongOwner === false && stillThere === true,
      `respond=${wrongOwner}，pending 仍在=${stillThere}`,
    );

    // D5 后台 pending 不因「看不见」而被静默判死：活过 2 个超时窗口仍未起表
    await sleep(TIMEOUT_MS * 2 + 120);
    const snap2 = pendingApprovalSnapshot().find((p) => p.conversationId === bg.id);
    check(
      "D5a 后台 pending 活过 2×超时窗口且未起计时表（不被静默拒）",
      Boolean(snap2) && snap2!.armed === false && snap2!.pendingMs > TIMEOUT_MS,
      snap2 ? `pendingMs=${Math.round(snap2.pendingMs)}ms armed=${snap2.armed}` : "pending 已消失",
    );

    // 切过去 → 起表 → 超时才落 deny（可见性分档的另一半）
    setActiveConversation(bg.id);
    armPendingTimeoutsFor(bg.id);
    const snap3 = pendingApprovalSnapshot().find((p) => p.conversationId === bg.id);
    check("D5b 切到该对话后计时表起来", snap3?.armed === true, `armed=${String(snap3?.armed)}`);
    const verdict = await pendingPromise;
    const gone = !pendingApprovalSnapshot().some((p) => p.conversationId === bg.id);
    check(
      "D5c 起表后超时确实落 deny 且 pending 出清",
      verdict.allow === false && /拒绝/.test(verdict.reason ?? "") && gone,
      `${verdict.allow} / ${verdict.reason}`,
    );
    void projB;
    code = results.every((r) => r.ok) ? 0 : 1;
  } catch (err) {
    check("探针异常", false, err instanceof Error ? err.message : String(err));
  } finally {
    // 策略必须恢复：探针不该把用户的审批档位留在改动状态
    try {
      replaceSection("approval", savedPolicy ?? { mode: "highRisk", rules: [] });
      console.log(`  · 已恢复审批策略为 ${savedPolicy?.mode ?? "highRisk"}`);
    } catch (err) {
      console.warn(`  · ⚠ 恢复审批策略失败，请手工检查设置：${String(err)}`);
    }
    for (const c of listConversations()) await import("./conversation-registry").then((m) => m.closeConversation(c.id).catch(() => undefined));
    await shutdownAllConversations().catch(() => undefined);
  }

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n=== 结论：${pass}/${results.length} 条通过 ===`);
  process.exitCode = code;
  app.exit(code);
}
