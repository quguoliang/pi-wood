import { app } from "electron";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { execFile } from "node:child_process";
import type { EngineEvent, HostToolResult } from "@pi-wood/ipc-schema";
import { ALL_HOST_TOOL_SPECS } from "../agent-tools/host-tool-specs";
import { resolveEngineChildEntry } from "./engine-host";
import {
  closeConversation,
  configureCapabilities,
  ensureConversation,
  getConversation,
  listConversations,
  shutdownAllConversations,
} from "./conversation-registry";

/**
 * T8.1 多对话探针（headless，不需要模型密钥）
 *
 * 把「引擎进 utilityProcess + 对话注册表」这条主干在**真子进程**上跑通并给出可判定断言，
 * 不等 T8.8 的并发探针、也不靠人肉点界面。覆盖：
 *   C6 child 入口可解析（打包形态正是 T8.0/P1-d 的缺口，这里当门禁复验）
 *   C1 三路并存：不同项目各自 fork，pid 互不相同、工具集全等且含 9 个宿主代理工具
 *   C5 帧往返：下行 invoke 与 start 回执的 pid 自洽；上行事件 seq 单调不串号
 *   C2 超限准入：把上限降到 2 → 挤掉最久未活跃的 idle 对话，suspended 的 child 确已退出，可唤醒
 *   C3 崩溃隔离：杀一个 child → 其余对话与主进程不受牵连，dead 对话按退避自动恢复（换 pid）
 *   C4 零残留：全量关停后 node/python 进程数回基线（= session_shutdown 真的生效）
 *
 * 用法：`pnpm --filter @pi-wood/desktop probe:conversation`；退出码 0 = 全绿。
 * 刻意不建窗口 + 跳过单例锁：可与正在跑的 dev 实例并存。
 */

let failures = 0;
let checks = 0;
const notes: string[] = [];

function ok(cond: boolean, label: string, detail = ""): void {
  checks += 1;
  if (!cond) failures += 1;
  const line = `  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`;
  console.log(line);
  notes.push(line);
}

function info(label: string): void {
  console.log(`  · ${label}`);
  notes.push(`  · ${label}`);
}

const LIVE = ["spawning", "idle", "streaming", "waiting_approval", "queued"];
const eventsByConv = new Map<string, { total: number; lastSeq: number; outOfOrder: number }>();
const toasts: string[] = [];
let approvalsAsked = 0;

/** 探针不接渲染层：审批一律拒（顺带验证 deny-by-default），UI 静默，事件只计数 */
function installStubCaps(maxLive: number): void {
  configureCapabilities({
    hostToolNames: () => ALL_HOST_TOOL_SPECS.map((s) => s.name),
    additionalExtensionPaths: () => [],
    executeHostTool: async (p): Promise<HostToolResult> => ({
      content: [{ type: "text", text: `probe-host:${p.name}` }],
      details: { ok: true },
    }),
    requestUi: async () => undefined,
    decideApproval: async () => {
      approvalsAsked += 1;
      return { allow: false, reason: "探针无渲染层，一律拒绝（deny-by-default）" };
    },
    onSubagent: () => undefined,
    onEngineEvent: (ctx, event: EngineEvent) => {
      const rec = eventsByConv.get(ctx.conversationId) ?? { total: 0, lastSeq: -1, outOfOrder: 0 };
      rec.total += 1;
      if (ctx.seq <= rec.lastSeq) rec.outOfOrder += 1;
      rec.lastSeq = ctx.seq;
      eventsByConv.set(ctx.conversationId, rec);
    },
    notify: (message) => toasts.push(message),
    maxLiveEngines: () => maxLive,
    maxRestarts: () => 2,
  });
}

function makeProject(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `piwood-conv-${tag}-`));
  writeFileSync(join(dir, "README.md"), `# probe ${tag}\n`, "utf-8");
  return dir;
}

function countEngineish(): Promise<number> {
  if (process.platform !== "win32") return Promise.resolve(-1);
  return new Promise((resolve) => {
    execFile("tasklist", ["/FI", "STATUS eq RUNNING", "/FO", "CSV", "/NH"], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(-1);
      let n = 0;
      for (const line of stdout.split("\n")) {
        const m = line.match(/^"([^"]+)","(\d+)"/);
        const name = m?.[1]?.toLowerCase();
        if (name === "node.exe" || name === "python.exe") n += 1;
      }
      resolve(n);
    });
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const statuses = (): string => listConversations().map((s) => `${s.projectDir.slice(-2)}:${s.status}`).join(" ");

async function runProbe(): Promise<void> {
  console.log("\n===== T8.1 多对话探针（真 utilityProcess 引擎，无模型密钥）=====");

  const entry = resolveEngineChildEntry();
  ok(Boolean(entry.entry), "C6 引擎子进程入口可解析", entry.entry ?? `✗ 候选=${entry.candidates.join(" | ")}`);
  if (!entry.entry) {
    failures += 1;
    return;
  }

  const baseline = await countEngineish();
  info(`起始 node/python 计数=${baseline === -1 ? "（非 win32 / tasklist 不可用，跳过残留度量）" : String(baseline)}`);

  // ---------- C1 三路并存 ----------
  installStubCaps(3);
  const dirs = [makeProject("a"), makeProject("b"), makeProject("c")];
  const t0 = performance.now();
  const adapters = [];
  for (const d of dirs) adapters.push(await ensureConversation(d));
  const spawnMs = Math.round(performance.now() - t0);
  const convs = listConversations();
  const pids = convs.map((c) => getConversation(c.id)?.boot?.pid ?? -1);
  ok(convs.length === 3, "C1.1 三条对话并存", `count=${convs.length} [${statuses()}]`);
  ok(new Set(pids).size === 3, "C1.2 三条对话各自独立 pid", pids.join(","));
  ok(
    pids.every((p) => p > 0 && p !== process.pid),
    "C1.3 引擎确实不在主进程内跑",
    `main=${process.pid} children=${pids.join(",")}`,
  );
  const toolSets: string[][] = [];
  for (const a of adapters) toolSets.push((await a.getRuntimeInfo()).tools ?? []);
  const sameSets = toolSets.every((s) => s.length === toolSets[0].length && s.every((t) => toolSets[0].includes(t)));
  ok(sameSets, "C1.4 三个 child 的工具集逐个全等", `每集 ${toolSets[0].length} 个`);
  const hostNames = ALL_HOST_TOOL_SPECS.map((s) => s.name);
  const proxyVisible = toolSets[0].filter((t) => hostNames.includes(t));
  ok(proxyVisible.length === hostNames.length, "C1.5 9 个宿主代理工具已进 session 工具集", proxyVisible.join(","));
  const boot = getConversation(convs[0].id)?.boot;
  info(`C1.6 三路装配总耗时=${spawnMs}ms；单路 timings=${JSON.stringify(boot?.timings ?? {})}；child RSS=${boot?.memRssMB ?? "?"}MB`);
  ok(spawnMs < 15_000, "C1.7 三路冷启动在 15s 内完成", `${spawnMs}ms`);

  // ---------- C5 帧往返 / seq ----------
  const conv0 = getConversation(convs[0].id);
  const stats = (await conv0?.host.invoke("stats", {})) as { pid: number; hasEngine: boolean };
  ok(stats?.pid === boot?.pid && stats.hasEngine === true, "C5.1 下行 invoke 往返自洽（stats.pid == start 回执 pid）", JSON.stringify(stats));
  const ev = [...eventsByConv.values()].reduce((n, e) => n + e.total, 0);
  const ooo = [...eventsByConv.values()].reduce((n, e) => n + e.outOfOrder, 0);
  ok(ooo === 0, "C5.2 上行事件 seq 单调（无重复/倒退帧）", `事件帧=${ev}，越界=${ooo}`);

  // ---------- C2 超限准入 ----------
  installStubCaps(2); // 现在表里有 3 条 idle 活跃对话
  const d4 = makeProject("d");
  const tSuspend = performance.now();
  await ensureConversation(d4); // 应挤掉最久未活跃者（含必要时多条）
  const suspendMs = Math.round(performance.now() - tSuspend);
  const snap = listConversations();
  const live = snap.filter((s) => LIVE.includes(s.status));
  const suspended = snap.filter((s) => s.status === "suspended");
  ok(live.length === 2, "C2.1 新建后活跃引擎数不超过上限 2", `live=${live.length} [${statuses()}]`);
  ok(suspended.length >= 1, "C2.2 超限把最久未活跃的 idle 对话休眠了", `suspended=${suspended.length}`);
  ok(
    suspended.every((s) => !getConversation(s.id)?.host.alive),
    "C2.3 休眠对话的 child 确已退出",
    suspended.map((s) => `${s.id.slice(-4)}:${getConversation(s.id)?.host.exitCode}`).join(","),
  );
  info(`C2.4 腾位置+新建一路耗时=${suspendMs}ms（含等 child 优雅退出）`);
  const wake = suspended[0];
  if (wake) {
    const woke = await ensureConversation(wake.projectDir);
    const st = await woke.getState();
    ok(Boolean(st?.sessionId), "C2.5 休眠对话可唤醒并读到会话状态", `session=${String(st.sessionId).slice(0, 8)}`);
  }

  // ---------- C3 崩溃隔离 ----------
  const d5 = makeProject("f");
  await ensureConversation(d5);
  const victim = conversationIdOf(d5);
  // 只比对「崩溃前确实活跃」的对话：C2 里合法休眠的那些本来就没有进程，算进来会把判据写歪
  const others = listConversations().filter((s) => s.id !== victim && LIVE.includes(s.status));
  const vh = getConversation(victim ?? "");
  const victimPid = vh?.host.pid;
  vh?.host.kill();
  await sleep(4_000); // 退避 500ms + 装配 ≈1.1s + 余量
  const after = victim ? getConversation(victim) : undefined;
  const revivedPid = after?.boot?.pid;
  ok(Boolean(revivedPid) && revivedPid !== victimPid && (after?.record.status ?? "dead") !== "dead", "C3.1 被杀 child 按退避自动恢复（换了新 pid）", `${victimPid} → ${revivedPid} status=${after?.record.status}`);
  const survivors = others.map((s) => (getConversation(s.id)?.host.alive ? 1 : 0));
  ok(survivors.length > 0 && survivors.every((x) => x === 1), "C3.2 其余对话不受牵连（崩溃隔离）", `alive=${survivors.join("")}/${others.length}`);
  const responsive = after ? await after.host.invoke("stats", {}).then(() => true).catch(() => false) : false;
  ok(responsive === true, "C3.3 主进程存活且帧管道可用（恢复后的对话能完成一次下行往返）");

  // ---------- C4 全量关停 + 零残留 ----------
  for (const s of listConversations().filter((x) => x.status === "suspended")) await closeConversation(s.id);
  const tQuit = performance.now();
  await shutdownAllConversations();
  const quitMs = Math.round(performance.now() - tQuit);
  const after2 = await countEngineish();
  info(`C4.1 全量关停耗时=${quitMs}ms；剩余记录=${statuses() || "表已空"}`);
  if (baseline >= 0 && after2 >= 0) {
    ok(after2 - baseline <= 0, "C4.2 node/python 回到基线（零残留 = session_shutdown 生效）", `基线=${baseline} 现在=${after2} Δ=${after2 - baseline}`);
  } else {
    info("C4.2 非 win32 或 tasklist 不可用：跳过残留计数（本机门禁才有效）");
  }

  for (const d of [...dirs, d4, d5]) {
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* 临时目录留给 OS 回收 */
    }
  }
  info(`反向通道计数：decideApproval=${approvalsAsked} 次（模型未跑 → 0 次属正常）；toast=${toasts.length} 条`);
  if (toasts.length) info(`toast 样例：${toasts.slice(0, 3).join(" | ")}`);
  console.log(`\n===== 结论：${checks} 项检查，失败 ${failures} 项 =====`);
}

function conversationIdOf(projectDir: string): string | undefined {
  return listConversations().find((c) => c.projectDir === projectDir)?.id;
}

export function isConversationProbeMode(argv = process.argv): boolean {
  return argv.some((a) => a.startsWith("--conversation-probe"));
}

/** headless 跑完即退（退出码即判据），绝不进入正常启动流程 */
export async function runConversationProbe(): Promise<void> {
  const started = performance.now();
  let code = 0;
  try {
    await runProbe();
  } catch (err) {
    console.error("[conversation-probe] 崩了：", err);
    failures += 1;
  }
  code = failures === 0 ? 0 : 1;
  console.log(`[conversation-probe] 用时 ${Math.round(performance.now() - started)}ms，checks=${checks} failures=${failures}`);
  try {
    // 打包态：GUI exe 无 stdout，且证据要能被仓库侧读到 → 落在 exe 同级目录（与 T8.0 同一口径）
    const evidenceDir = app.isPackaged ? join(dirname(process.execPath), "T8.1-proofs") : tmpdir();
    mkdirSync(evidenceDir, { recursive: true }); // 打包态该目录不存在，不建就直接 writeFileSync 抛错
    writeFileSync(
      join(evidenceDir, "conversation-probe.txt"),
      `${new Date().toISOString()} form=${app.isPackaged ? "packaged" : "dev"} checks=${checks} failures=${failures}\n${notes.join("\n")}\n`,
      "utf-8",
    );
  } catch {
    /* 证据写不进去也不该盖掉退出码 */
  }
  app.exit(code);
}
