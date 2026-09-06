import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { app, BrowserWindow } from "electron";
import { LATENCY_BUDGETS, budgetVerdict, formatLatencyReport } from "@pi-wood/ipc-schema";
import { ensureEngine } from "./engine-manager";
import { engineLatencySummary, getConversation, listConversations } from "./conversation-registry";
import { resetRendererLatency } from "./renderer-latency";

/**
 * T8.10 带窗形态红线探针 `electron . --ui-latency-probe`
 *
 * 补无窗的 `--latency-probe` 测不到的三行红线：**事件两跳的第二跳（main→renderer）**、
 * **切换已激活对话首屏**、**流式期间掉帧与主进程 CPU**。合成不出来的部分就不在无窗探针里假装测。
 *
 * 负载怎么造：三条对话同时经**真实 IPC 通道**灌 `debugEcho` 事件（active 那条逐帧透传、
 * 后台两条走 T8.3 合帧节流）——这就是「三路并发流式」在通道与渲染层上的真实形状。
 * ⚠ **不含模型 token 生成成本**，测的是「事件到了渲染层之后这条管子扛不扛得住」，
 * 不许引用成「真模型三路流式就这么快」。
 *
 * 前提：窗口必须可见（Chromium 会节流不可见页面的 rAF）。样本为 0 时 `budgetVerdict`
 * 直接判不通过——不会把「没测到」混成「达标」。
 */

/**
 * 负载形状：**按接近真实流式的速率灌**（300 帧 × 16ms ≈ 60 token/秒/对话，三路合计 ~180 帧/秒）。
 * 不用突发全速——突发测的是「管子塞多快」（排队延迟），会把 20ms 到达预算判成爆表，
 * 那是负载模型错了而不是产品慢了。09-05 首跑就用 600 帧无间隔，rendererHop p95 直接 261ms。
 */
const EVENTS_PER_CONV = 300;
const PACE_GAP_MS = 16;
const SWITCH_ROUNDS = 6;
const FLUSH_WAIT_MS = 2600; // 渲染层批量上报周期是 2s，多等一点让样本落窗
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 切到指定对话（必须经渲染层）：优先点左栏树行（真用户路径），树里没有（探针临时项目
 * 不在项目列表）→ 落到渲染层调试钩子 `__piwoodSwitchConversation`（同一条 store 路径，
 * markSwitchStart→首帧的度量段与点击完全一致）。两者都失败才算点不到。
 */
async function switchConversation(win: BrowserWindow, conversationId: string): Promise<boolean> {
  const clicked = await win.webContents
    .executeJavaScript(
      `(() => {
        const row = document.querySelector('[data-conversation-id="${conversationId}"]');
        if (!row) return false;
        row.click();
        return true;
      })()`,
    )
    .then((ok: unknown) => ok === true)
    .catch(() => false);
  if (clicked) return true;
  return win.webContents
    .executeJavaScript(
      `(() => {
        const sw = window.__piwoodSwitchConversation;
        if (typeof sw !== "function") return false;
        sw(${JSON.stringify(conversationId)});
        return true;
      })()`,
    )
    .then((ok: unknown) => ok === true)
    .catch(() => false);
}

/** 临时项目必须是真 git 仓库，否则 worktree 降级为共享主树（与 concurrency-probe 同口径） */
function makeProject(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `piwood-uilat-${tag}-`));
  writeFileSync(join(dir, "README.md"), `# ui latency probe ${tag}\n`, "utf-8");
  const run = (args: string[]): void => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  };
  run(["init", "-q"]);
  run(["config", "user.email", "probe@piwood.dev"]);
  run(["config", "user.name", "piwood-ui-latency-probe"]);
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "probe base"]);
  return dir;
}

function capture(file: string): Promise<void> {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return Promise.resolve();
  return win.webContents
    .capturePage()
    .then((image) => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, image.toPNG());
      console.log(`[ui-latency] captured ${file}`);
    })
    .catch((err: unknown) => {
      console.warn(`[ui-latency] 截图失败（不影响判定）：${err instanceof Error ? err.message : String(err)}`);
    });
}

export function isUiLatencyProbeMode(): boolean {
  return process.argv.includes("--ui-latency-probe");
}

export async function runUiLatencyProbe(): Promise<void> {
  // 必须在 ensureEngine 之前设：EngineHost 把当时的 process.env 字符串化后传给 child
  process.env.PIWOOD_ENGINE_PROBE = "1";
  const idx = process.argv.indexOf("--ui-latency-probe");
  const shot = process.argv[idx + 1] ?? join(app.getAppPath(), "docs", "proofs", "T8.8", "ui-latency-probe.png");
  const results: Array<{ name: string; ok: boolean; note: string }> = [];
  const check = (name: string, ok: boolean, note = ""): void => {
    results.push({ name, ok, note });
    console.log(`${ok ? "✓" : "✗"} ${name}${note ? ` — ${note}` : ""}`);
  };

  console.log("=== T8.10 --ui-latency-probe（带窗：第二跳 / 首屏 / 掉帧 / 主进程 CPU） ===");
  resetRendererLatency(); // 上一轮或本进程早期的样本不参与本轮判定
  let code = 1;
  try {
    // 三条对话：同项目 ×2（各占一棵 worktree）+ 跨项目 ×1，与 concurrency-probe 同形状
    const projA = makeProject("a");
    const projB = makeProject("b");
    await ensureEngine(projA);
    await ensureEngine(projA, { newConversation: true });
    await ensureEngine(projB);
    const convIds = listConversations().map((c) => c.id);
    if (convIds.length < 3) throw new Error(`三路并发需要 ≥3 条对话，实际 ${convIds.length}`);
    const hosts = convIds.slice(0, 3).map((id) => getConversation(id)?.host);
    if (hosts.some((h) => !h)) throw new Error("有对话的 EngineHost 未就位");

    // 先让渲染层自己选定一条（树行点击/调试钩子 = 真渲染层路径；都失败说明渲染层没就绪）
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error("探针需要可见窗口：BrowserWindow 未创建");
    if (!(await switchConversation(win, convIds[0]!))) throw new Error("渲染层切换入口不可用，首屏与第二跳都无从测起");
    await sleep(400);

    // ① 三路按接近模型的速率同时灌事件（不 await：切换要在负载进行中做）
    const load = Promise.all(
      hosts.map((h) => h!.invoke("debugEcho", { events: EVENTS_PER_CONV, approvals: 0, gapMs: PACE_GAP_MS })),
    );

    // ② 负载期间连切对话：起点在渲染层 store，首帧提交时配平
    let clicked = 0;
    for (let i = 0; i < SWITCH_ROUNDS; i += 1) {
      if (await switchConversation(win, convIds[i % convIds.length]!)) clicked += 1;
      await sleep(260);
    }
    await load; // 300 帧 × 16ms ≈ 4.8s/路，三路并发
    if (clicked < SWITCH_ROUNDS) console.warn(`  · 有 ${SWITCH_ROUNDS - clicked} 次切换没成功（对话数 ${convIds.length}？）`);
    await sleep(FLUSH_WAIT_MS);

    const sum = engineLatencySummary();
    const load0 = `${EVENTS_PER_CONV * convIds.slice(0, 3).length} 帧 / ${convIds.slice(0, 3).length} 路 / 间隔 ${PACE_GAP_MS}ms`;
    const vHop = budgetVerdict(sum.report.rendererHop, LATENCY_BUDGETS.rendererHopP95Ms, "rendererHop(main→renderer)");
    check("U1 事件两跳第二跳 p95 达标", vHop.ok, `${vHop.note}；负载=${load0}`);

    const vGap = budgetVerdict(sum.report.frameGap, LATENCY_BUDGETS.frameGapP95Ms, "frameGap(rAF 帧间隔)");
    check("U2 三路并发流式期间无明显掉帧（帧间隔 p95 ≤33.3ms）", vGap.ok, vGap.note);

    const cpu = sum.mainCpuPct;
    check(
      "U3 流式期间主进程 CPU ≤ 单核 60%",
      cpu.count > 0 && cpu.p95 <= LATENCY_BUDGETS.mainCpuP95Pct,
      `p95=${cpu.p95}%（预算 ≤${LATENCY_BUDGETS.mainCpuP95Pct}%，n=${cpu.count}；无样本不判达标）`,
    );

    const vPaint = budgetVerdict(sum.report.firstPaint, LATENCY_BUDGETS.firstPaintP95Ms, "firstPaint(切换首屏)");
    check(`U4 切换已激活对话首屏 p95 达标（切了 ${SWITCH_ROUNDS} 次）`, vPaint.ok, vPaint.note);

    check(
      "U5 上报链路健康（有样本进窗、无非法批次 = 桥与主进程版本同步）",
      sum.reportedSamples > 0 && sum.rejectedBatches === 0,
      `reportedSamples=${sum.reportedSamples} rejectedBatches=${sum.rejectedBatches}`,
    );

    console.log(`  · 全量摘要：${formatLatencyReport(sum.report)}`);
    console.log(`  · 主进程 CPU：p50=${cpu.p50}% p95=${cpu.p95}% max=${cpu.max}%（n=${cpu.count}）`);
    console.log("  · 口径提醒：负载是 debugEcho 合成事件（不含模型生成），测的是通道 + 渲染管线扛不扛得住");
    code = results.every((r) => r.ok) ? 0 : 1;
  } catch (err) {
    check("探针异常", false, err instanceof Error ? err.message : String(err));
  }

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n=== 结论：${pass}/${results.length} 条通过 ===`);
  await capture(shot);
  process.exitCode = code;
  app.exit(code); // 主进程设 exitCode 不会退出 Electron
}
