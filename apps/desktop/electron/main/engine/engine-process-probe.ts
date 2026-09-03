import { app, utilityProcess } from "electron";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { SdkAdapter } from "@pi-wood/engine/sdk";
import { reinjectProviderEnv } from "../provider/provider-manager";

/**
 * T8.0 P1 前置探针：utilityProcess 引擎可行性（方案 D 的 Go/No-Go 门禁之一）。
 *
 * 无窗口、不加载桌面引擎，只 fork 子进程跑装配链，输出计量 + 断言，自检后 app.exit(0/1)。
 * 判据（执行计划 §7.9 T8.0 验收）：
 *   P1-a 装载性：child 内工具集 == 主进程内基线（含社区包工具），diagnostics 无 error
 *   P1-b 双向 RPC：事件流 / 反向 tool:execute / 反向 ui:confirm 三链路闭环 + cancel 可达 + child 崩溃不伤主进程
 *   P1-c 成本与残留：1/2/3 个 child 的 fork→ready→装配 ms、RSS、tasklist 基线回归（MCP 零残留）
 *   P1-d 打包形态：child 入口在 dev/packaged 下的可解析性（本进程只报解析结果，packaged 复跑由脚本驱动）
 *
 * 用法：pnpm --filter @pi-wood/desktop probe:engine-process（或 electron . --engine-process-probe）
 */

const FLAG = "--engine-process-probe";
/** 逗号分隔的额外开关：`--engine-process-probe=packaged` 时跳过主进程基线（打包态没有 workspace 源码） */
const ARGS = (process.argv.find((a) => a.startsWith(`${FLAG}=`)) ?? "").slice(FLAG.length + 1).split(",").filter(Boolean);
const FORM = ARGS.includes("packaged") ? "packaged" : "dev";

export function isEngineProcessProbeMode(): boolean {
  return process.argv.some((a) => a === FLAG || a.startsWith(`${FLAG}=`));
}

/* ---------------- 小工具 ---------------- */

const lines: string[] = [];
function say(s = ""): void {
  lines.push(s);
  console.log(s);
}
function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function tasklistSnapshot(): Map<string, number> {
  const map = new Map<string, number>();
  try {
    const out = execFileSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8", timeout: 15_000 });
    for (const row of out.split(/\r?\n/)) {
      const name = row.match(/^"([^"]+)"/)?.[1];
      if (name) map.set(name.toLowerCase(), (map.get(name.toLowerCase()) ?? 0) + 1);
    }
  } catch (e) {
    say(`! tasklist 失败：${(e as Error).message}`);
  }
  return map;
}
function rssOf(pid: number | undefined): number {
  if (!pid) return 0;
  try {
    const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", timeout: 10_000 });
    const m = out.match(/"(\d[\d,\s]*)\s*KB"/);
    return m ? Math.round(Number(m[1].replace(/[,\s]/g, "")) / 1024) : 0;
  } catch {
    return 0;
  }
}
function pidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", timeout: 10_000 });
    return new RegExp(`"\\s*${pid}\\s*","`).test(out) || out.includes(`,${pid},`);
  } catch {
    return false;
  }
}
/** 本探针起过的全部子进程（含 entry-probe / crashx），残留判定用 */
const allChildren: Child[] = [];

/* ---------------- 子进程 RPC 客户端 ---------------- */

type Proc = ReturnType<typeof utilityProcess.fork>;

interface Child {
  label: string;
  proc: Proc;
  pid?: number;
  seq: number;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>;
  events: Array<{ type: string; len?: number; at: number }>;
  readyAt: number;
  forkAt: number;
  readyMs: number;
  loadRssMB?: number; // 装配完成时（未跑 prompt）的 child RSS，用于算净增
  dead: boolean;
  exitCode?: number;
}

/** child 侧 ui 请求的脚本化应答（探针无渲染层；T8.1 才按对话归属路由到 PromptTray） */
const HOST_UI = { confirm: true, select: "a", input: "probe-answer" };

function makeToolExecuteSink(store: string[]): (name: string, params: unknown) => string {
  return (name, params) => {
    store.push(`${name}:${JSON.stringify(params).slice(0, 60)}`);
    return `host-ok-${store.length}`;
  };
}

/** child 入口解析（P1-d）：dev 下 out/main/index.js → ../../electron/main/engine/engine-child.mjs（源码树）；
 *  packaged 下该相对路径落 asar 之外，只能靠随包资源（extraResources/asarUnpack）——解析不到即如实报。 */
export function resolveEngineChildEntry(): { here: string; candidates: string[]; entry?: string } {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../../electron/main/engine/engine-child.mjs"),
    join(here, "engine-child.mjs"),
    join(here, "../engine-child.mjs"),
  ];
  // 打包态：asarUnpack 的文件在 app.asar.unpacked 下，Electron 的 asar 补丁通常会把
  // app.asar 路径重定向过去；这里显式再列一条 unpacked 候选，避免依赖隐式重定向。
  const unpacked = candidates.map((p) => p.replace("app.asar/", "app.asar.unpacked/"));
  for (const p of unpacked) if (!candidates.includes(p)) candidates.push(p);
  return { here, candidates, entry: candidates.find((p) => existsSync(p)) };
}

function forkChild(label: string, cwd: string, toolSink: string[]): Child {
  const { candidates, entry } = resolveEngineChildEntry();
  say(`  [${label}] child 入口解析（form=${FORM}）：${entry ?? `✗ 未找到，候选=${candidates.map((c) => c.replace(/\\/g, "/")).join(" | ")}`}`);
  if (!entry) throw new Error("engine-child.mjs 未找到（P1-d 打包资源缺口）");

  const forkAt = performance.now();
  // ⚠ env 值不许出现 undefined（utilityProcess 直接报 "Invalid value for env"，实测踩坑）
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
  env.PIWOOD_PROBE_CWD = cwd;
  delete env["ELECTRON_RUN_AS_NODE"];
  const proc = utilityProcess.fork(entry, [], {
    stdio: ["ignore", "pipe", "pipe"],
    serviceName: `pi-wood-engine-probe-${label}`,
    env,
  });
  const c: Child = {
    label,
    proc,
    seq: 0,
    pending: new Map(),
    events: [],
    readyAt: 0,
    forkAt,
    readyMs: -1,
    dead: false,
  };
  proc.on("message", (msg: unknown) => onChildMessage(c, msg, toolSink));
  proc.on("exit", (code: number) => {
    c.dead = true;
    c.exitCode = code;
    for (const [, p] of c.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`child ${label} 退出（code ${code}）`));
    }
    c.pending.clear();
  });
  proc.stdout?.on("data", (b: Buffer) => {
    const s = b.toString("utf8").trim();
    if (s) say(`    ${label}·out│ ${s.slice(0, 200)}`);
  });
  proc.stderr?.on("data", (b: Buffer) => {
    const s = b.toString("utf8").trim();
    if (s) say(`    ${label}·err│ ${s.slice(0, 200)}`);
  });
  c.pid = proc.pid;
  allChildren.push(c);
  return c;
}

function onChildMessage(c: Child, msg: unknown, toolSink: string[]): void {
  const m = msg as { kind?: string; id?: number; ok?: boolean; value?: unknown; error?: string; topic?: string; payload?: unknown; method?: string; args?: { name?: string; params?: unknown; title?: string; message?: string } };
  if (!m || typeof m !== "object") return;
  if (m.kind === "respond" && m.id !== undefined) {
    const p = c.pending.get(m.id);
    if (p) {
      clearTimeout(p.timer);
      c.pending.delete(m.id);
      m.ok ? p.resolve(m.value) : p.reject(new Error(m.error ?? "child 返回失败"));
    }
    return;
  }
  if (m.kind === "event" && m.topic === "engine") {
    c.events.push(m.payload as { type: string; len?: number; at: number });
    return;
  }
  if (m.kind === "event" && m.topic === "ready") {
    c.readyAt = performance.now();
    c.readyMs = Math.round(c.readyAt - c.forkAt);
    // ⚠ Electron 侧 proc.pid 在本机取到 undefined，改由 child 自报（ready 帧带 process.pid）
    const p = m.payload as { pid?: number };
    if (typeof p.pid === "number") c.pid = p.pid;
    return;
  }
  if (m.kind === "event" && m.topic === "milestone") {
    const p = m.payload as { what?: string; ms?: number; at?: number; mem?: Record<string, number> };
    say(`    ${c.label}·milestone│ ${p.what} ${p.ms ?? ""}ms @${p.at ?? ""} ${JSON.stringify(p.mem ?? {})}`);
    return;
  }
  if (m.kind === "event" && m.topic === "log") {
    const p = m.payload as { level?: string; text?: string };
    say(`    ${c.label}·log│ [${p.level}] ${p.text}`);
    return;
  }
  if (m.kind === "invoke" && m.id !== undefined) {
    // 反向 RPC：child → 宿主
    void (async () => {
      let ok = true;
      let value: unknown;
      let error: string | undefined;
      try {
        switch (m.method) {
          case "tool:execute":
            value = makeToolExecuteSink(toolSink)(String(m.args?.name), m.args?.params);
            break;
          case "ui:confirm":
            value = HOST_UI.confirm;
            break;
          case "ui:select":
            value = HOST_UI.select;
            break;
          case "ui:input":
            value = HOST_UI.input;
            break;
          case "ui:notify":
            value = true;
            break;
          default:
            throw new Error(`宿主未知方法 ${m.method}`);
        }
      } catch (e) {
        ok = false;
        error = (e as Error).message;
      }
      c.proc.postMessage({ kind: "respond", id: m.id, ok, value, error });
    })();
  }
}

function call<T = unknown>(c: Child, method: string, args?: unknown, timeoutMs = 120_000): Promise<T> {
  const id = ++c.seq;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      c.pending.delete(id);
      reject(new Error(`${method} 超时 ${timeoutMs}ms`));
    }, timeoutMs);
    c.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    c.proc.postMessage({ kind: "invoke", id, method, args });
  });
}

/* ---------------- 主进程内基线（P1-a 的对照组） ---------------- */

interface LoadReport {
  tools: string[];
  extensionCount: number;
  extensionNames: string[];
  skills: string[];
  diagnostics: Array<{ type?: string; message?: string }>;
  bootMs: number;
  sessionId?: string;
}

async function inProcessBaseline(cwd: string): Promise<LoadReport> {
  const t0 = performance.now();
  const adapter = new SdkAdapter();
  await adapter.start({ projectDir: cwd, uiBridge: { notify: () => {}, select: async () => undefined, confirm: async () => false, input: async () => undefined } });
  const info = await adapter.getRuntimeInfo();
  const report: LoadReport = {
    tools: info.tools ?? [],
    extensionCount: -1,
    extensionNames: [],
    skills: [],
    diagnostics: [],
    bootMs: Math.round(performance.now() - t0),
    sessionId: adapter.getSessionId(),
  };
  await adapter.stop();
  return report;
}

/* ---------------- 断言台账 ---------------- */

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = ""): void {
  checks.push({ name, ok, detail });
  say(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/* ---------------- 主流程 ---------------- */

/** 探针日志落盘目录（按可写性挑第一个）：dev 的 docs/proofs、packaged 的 exe 同目录、兜底临时目录 */
function proofsDir(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "..", "..", "docs", "proofs", "T8.0"), join(dirname(app.getPath("exe")), "T8.0-proofs"), join(app.getPath("temp"), "piwood-t80")];
  for (const d of candidates) {
    try {
      mkdirSync(d, { recursive: true });
      return d;
    } catch {
      /* 下一个 */
    }
  }
  return undefined;
}

export async function runEngineProcessProbe(): Promise<void> {
  // 先落一个 started 标记：打包态 exe 无 stdout，若只有标记没有完整日志=中途静默崩溃
  try {
    const d = proofsDir();
    if (d) writeFileSync(join(d, `engine-process-${FORM}.started`), new Date().toISOString(), "utf8");
  } catch {
    /* 标记失败不阻塞探针 */
  }
  say(`=== T8.0 P1 探针（form=${FORM}，node=${process.versions.node}，electron=${process.versions.electron}）===`);
  const projectDir = (() => {
    try {
      const s = JSON.parse(readFileSync(join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".pi-wood", "settings.json"), "utf8")) as { lastProject?: string };
      if (s.lastProject && existsSync(s.lastProject)) return s.lastProject;
    } catch {
      /* 无设置则回落 */
    }
    return process.cwd();
  })();
  say(`项目目录（探针 cwd 基准）：${projectDir}`);

  // 凭据：钥匙串 → env（子进程继承），否则真 prompt 无法跑
  reinjectProviderEnv();
  const hasKey = Boolean(process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY);
  say(`凭据：${hasKey ? "已注入（可真发 prompt）" : "⚠ 未检出 API key —— 真 prompt 相关项将标为跳过而非通过"}`);

  const base = tasklistSnapshot();
  say(`基线进程数：electron.exe=${base.get("electron.exe") ?? 0} node.exe=${base.get("node.exe") ?? 0} 总=${[...base.values()].reduce((a, b) => a + b, 0)}`);

  /* ---------- P1-d 前置：child 入口解析（纯路径判定，不 fork——fork 完立刻 kill 会留下未观测的进程） ---------- */
  say("\n--- P1-d child 入口可解析性 ---");
  const resolved = resolveEngineChildEntry();
  check("P1-d child 入口在当前形态下可解析", Boolean(resolved.entry), `form=${FORM} → ${resolved.entry ?? `未找到，候选=${resolved.candidates.map((c) => c.replace(/\\/g, "/")).join(" | ")}`}`);
  if (!resolved.entry) {
    finish();
    return;
  }

  /* ---------- P1-a 装载性 ---------- */
  say("\n--- P1-a utilityProcess 内装载 SDK + 扩展 ---");
  let mainBaseline: LoadReport | undefined;
  if (FORM === "dev") {
    try {
      mainBaseline = await inProcessBaseline(projectDir);
      say(`  主进程内基线：boot=${mainBaseline.bootMs}ms tools=${mainBaseline.tools.length} [${mainBaseline.tools.join(", ")}]`);
    } catch (e) {
      say(`  ! 主进程基线装配失败（不影响 child 侧结论）：${(e as Error).message}`);
    }
  } else {
    say("  （packaged 形态：跳过主进程内基线，改用 child 侧自证 + 与 dev 记录比对）");
  }

  const toolSink: string[] = [];
  const c1 = forkChild("c1", projectDir, toolSink);
  const readyOk = await waitReady(c1, 30_000);
  check("P1-a fork→ready 子进程存活", readyOk, `ready=${c1.readyMs}ms pid=${c1.pid}`);
  let load1: LoadReport & { mem?: Record<string, number>; servicesMs?: number; sessionMs?: number; bindMs?: number; cwd?: string } | undefined;
  try {
    load1 = (await call(c1, "load", { tag: "c1" })) as typeof load1;
  } catch (e) {
    say(`  ✗ child load 失败：${(e as Error).message}`);
  }
  if (load1) {
    say(`  child 装配：services=${load1.servicesMs}ms session=${load1.sessionMs}ms bind=${load1.bindMs}ms 合计 boot=${load1.bootMs}ms`);
    say(`  child 工具（${load1.tools.length}）：[${load1.tools.join(", ")}]`);
    say(`  child 扩展数=${load1.extensionCount} skills=[${load1.skills.join(",")}] diagnostics=${JSON.stringify(load1.diagnostics)}`);
    const errDiag = (load1.diagnostics ?? []).filter((d) => d.type === "error");
    check("P1-a child 内 diagnostics 无 error", errDiag.length === 0, errDiag.map((d) => d.message).join(" | ") || "0 条");
    check("P1-a child 内工具数 ≥ 内置 4", load1.tools.length >= 4, `${load1.tools.length}`);
    c1.loadRssMB = load1.mem?.rssMB;
    if (mainBaseline) {
      // 探针在 child 侧额外注册了 probe_host_echo，比对时按同一口径剔除（不是引擎差异）
      const probeOwn = ["probe_host_echo"];
      const childTools = load1.tools.filter((x) => !probeOwn.includes(x));
      const mainTools = mainBaseline.tools.filter((x) => !probeOwn.includes(x));
      const missing = mainTools.filter((x) => !childTools.includes(x));
      const extra = childTools.filter((x) => !mainTools.includes(x));
      check("P1-a child 工具集与主进程内基线一致（同口径，剔除探针自注册工具）", missing.length === 0 && extra.length === 0, missing.length ? `child 缺 ${missing.join(",")}` : extra.length ? `child 多 ${extra.join(",")}` : `${childTools.length} 个全等（含社区包 ${childTools.filter((x) => !["read", "bash", "edit", "write"].includes(x)).length} 个）`);
    }
    // 社区包工具是否真出现（对齐 §8 T3.1 的 plan_mode_* 判据）
    const community = load1.tools.filter((t) => !["read", "bash", "edit", "write", "probe_host_echo"].includes(t));
    check("P1-a 已装社区包的工具在 child 内出现", community.length > 0 || !hasExtensionsInstalled(), community.length ? community.slice(0, 6).join(",") : "（未装社区包，跳过）");
  }

  /* ---------- P1-b 双向 RPC ---------- */
  say("\n--- P1-b 双向 RPC 三链路 ---");
  if (load1) {
    try {
      const r = (await call(c1, "hostToolDirect", { text: "ping" })) as { value: string; hits: number };
      check("P1-b 反向 tool:execute 闭环（child→main→child）", typeof r.value === "string" && r.value.startsWith("host-ok-"), `${r.value}，宿主侧计数 ${toolSink.length}`);
    } catch (e) {
      check("P1-b 反向 tool:execute 闭环（child→main→child）", false, (e as Error).message);
    }
    try {
      const r = (await call(c1, "uiRoundTrip", {})) as { confirm: boolean; select: string; input: string };
      check("P1-b 反向 ui:confirm/select/input 闭环", r.confirm === HOST_UI.confirm && r.select === HOST_UI.select && r.input === HOST_UI.input, JSON.stringify(r));
    } catch (e) {
      check("P1-b 反向 ui:confirm/select/input 闭环", false, (e as Error).message);
    }
    if (hasKey) {
      const before = c1.events.length;
      try {
        const r = (await call(c1, "prompt", { text: "只回复两个字：收到" })) as { ms: number; eventsDuring: number; firstEventAt: number };
        check("P1-b 事件流（prompt 期间 child→main 有引擎事件帧到达）", r.eventsDuring > 0 || c1.events.length > before, `事件帧 ${c1.events.length - before}，首帧 @${r.firstEventAt}ms，本轮 ${r.ms}ms`);
        say(`  首 token 前事件到达：${r.firstEventAt}ms；本轮 settle：${r.ms}ms`);
      } catch (e) {
        check("P1-b 事件流（prompt 期间 child→main 有引擎事件帧到达）", false, (e as Error).message);
      }
      // cancel 可达：起一轮长任务，2s 后 cancel
      try {
        const p = call(c1, "slowPrompt", { text: "写一篇 2000 字的长文，慢慢写" }, 60_000).then(() => "settled").catch(() => "rejected");
        await sleep(4000);
        c1.proc.postMessage({ kind: "cancel", id: 0 });
        const evBefore = c1.events.length;
        const outcome = await Promise.race([p, sleep(20_000).then(() => "timeout")]);
        const stoppedEvents = c1.events.slice(evBefore).some((e) => /abort|cancel|settle|end/i.test(e.type));
        check("P1-b cancel 帧可中止在跑的一轮", outcome !== "timeout" || stoppedEvents, `outcome=${outcome}，abort 后仍收帧=${stoppedEvents}`);
      } catch (e) {
        check("P1-b cancel 帧可中止在跑的一轮", false, (e as Error).message);
      }
    } else {
      check("P1-b 事件流（真 prompt）", false, "无凭据，未跑（标失败不造假）");
    }
    // 崩溃隔离：另一个 child 硬崩，主进程与 c1 必须存活
    try {
      const cX = forkChild("crashx", projectDir, []);
      await waitReady(cX, 30_000);
      await call(cX, "load", { tag: "crashx" });
      cX.proc.postMessage({ kind: "control", name: "crash" });
      const died = await waitExit(cX, 15_000);
      check("P1-b child 崩溃能被观测到（exit 事件）", died, `code=${cX.exitCode}`);
      const alive = (await call(c1, "stats", {}, 15_000)) as { pid: number };
      check("P1-b child 崩溃不波及主进程与其它对话", alive.pid === c1.pid, `c1 pid ${c1.pid} 仍在响应 RPC`);
    } catch (e) {
      check("P1-b child 崩溃隔离", false, (e as Error).message);
    }
  }

  /* ---------- P1-c 成本与残留 ---------- */
  say("\n--- P1-c 1/2/3 个 child 的成本与残留 ---");
  const rows: Array<{ n: number; readyMs: number; loadMs: number; childRssMB: number; treeRssMB: number; firstTokenMs: number; events: number }> = [];
  const live: Child[] = load1 ? [c1] : [];
  if (load1) {
    // 用装配完成时（未跑 prompt）的 RSS 作净增基线，否则混入一轮对话的缓存
    rows.push({ n: 1, readyMs: c1.readyMs, loadMs: load1.bootMs, childRssMB: c1.loadRssMB ?? 0, treeRssMB: rssOf(c1.pid), firstTokenMs: -1, events: c1.events.length });
  }
  for (let n = live.length + 1; n <= 3; n++) {
    const sink: string[] = [];
    const c = forkChild(`c${n}`, projectDir, sink);
    const ok = await waitReady(c, 30_000);
    if (!ok) {
      check(`P1-c 第 ${n} 个 child 起得来`, false, `readyMs=${c.readyMs}`);
      break;
    }
    let loadMs = -1;
    let rss = 0;
    try {
      const l = (await call(c, "load", { tag: `c${n}` })) as { bootMs: number };
      loadMs = l.bootMs;
      const st = (await call(c, "stats", {}, 15_000)) as { mem: Record<string, number> };
      rss = st.mem.rssMB;
    } catch (e) {
      say(`  ! c${n} load 失败：${(e as Error).message}`);
    }
    rows.push({ n, readyMs: c.readyMs, loadMs, childRssMB: rss, treeRssMB: rssOf(c.pid), firstTokenMs: -1, events: c.events.length });
    live.push(c);
    say(`  #${n} ready=${c.readyMs}ms load=${loadMs}ms childRSS=${rss}MB pidRSS=${rows.at(-1)!.treeRssMB}MB`);
  }
  const snapMid = tasklistSnapshot();
  say(`  起 ${live.length} 个后进程数：electron.exe=${snapMid.get("electron.exe") ?? 0} node.exe=${snapMid.get("node.exe") ?? 0} python.exe=${snapMid.get("python.exe") ?? 0} 总=${[...snapMid.values()].reduce((a, b) => a + b, 0)}`);

  // 全部关停：先 runtime.dispose()（广播 session_shutdown）再退出
  for (const c of live) {
    try {
      const r = (await call(c, "shutdown", {}, 60_000)) as { disposeMs: number };
      say(`  ${c.label} runtime.dispose=${r.disposeMs}ms`);
    } catch (e) {
      say(`  ! ${c.label} shutdown 异常：${(e as Error).message}（直接 kill）`);
      try {
        c.proc.kill();
      } catch {
        /* noop */
      }
    }
    await waitExit(c, 10_000);
  }
  await sleep(2500);
  const snapEnd = tasklistSnapshot();
  const delta = (k: string) => (snapEnd.get(k) ?? 0) - (base.get(k) ?? 0);
  // 残留判据分两层：① 我们起过的子进程必须全部消失（含崩溃对照组）；
  // ② 扩展拉起的子进程（MCP 多为 node.exe）零残留。electron.exe 总数差另报——硬崩会留 crashpad 处理进程，属对照组副作用而非引擎泄漏。
  const stillAlive = allChildren.filter((c) => !c.dead && pidAlive(c.pid));
  say(`  关停后：electron.exe Δ${delta("electron.exe")} node.exe Δ${delta("node.exe")} python.exe Δ${delta("python.exe")} 总数 Δ${[...snapEnd.values()].reduce((a, b) => a + b, 0) - [...base.values()].reduce((a, b) => a + b, 0)}`);
  check("P1-c 探针起过的子进程全部退出（含崩溃对照组）", stillAlive.length === 0, stillAlive.map((c) => `${c.label}@${c.pid}`).join(",") || `${allChildren.length} 个全部离场`);
  check("P1-c 扩展/MCP 子进程零残留（node/python 计数回到基线）", delta("node.exe") <= 0 && delta("python.exe") <= 0, `node Δ${delta("node.exe")} python Δ${delta("python.exe")}（electron Δ${delta("electron.exe")} 为硬崩对照组的 crashpad 副作用，单独记录）`);

  /* ---------- 计量表回填 ---------- */
  say("\n--- 计量汇总（回填 §7.9 性能红线表用） ---");
  say(`  ${pad("n", 3)}${pad("ready ms", 11)}${pad("load ms", 10)}${pad("child RSS", 11)}${pad("pid RSS", 9)}${pad("事件帧", 8)}`);
  for (const r of rows) say(`  ${pad(String(r.n), 3)}${pad(String(r.readyMs), 11)}${pad(String(r.loadMs), 10)}${pad(`${r.childRssMB}MB`, 11)}${pad(`${r.treeRssMB}MB`, 9)}${pad(String(r.events), 8)}`);
  if (rows.length >= 2) {
    const perChild = Math.round(((rows.at(-1)!.childRssMB ?? 0) - (rows[0].childRssMB ?? 0)) / Math.max(1, rows.length - 1));
    say(`  每多一个对话的 child 净增 RSS ≈ ${perChild}MB（不含其扩展子进程；含扩展的真值看上面进程数增量）`);
  }

  finish();
}

function hasExtensionsInstalled(): boolean {
  try {
    const p = join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".pi", "agent", "settings.json");
    const s = JSON.parse(readFileSync(p, "utf8")) as { packages?: unknown[] };
    return Array.isArray(s.packages) && s.packages.length > 0;
  } catch {
    return false;
  }
}

async function waitReady(c: Child, ms: number): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (c.readyMs >= 0) return true;
    if (c.dead) return false;
    await sleep(100);
  }
  return c.readyMs >= 0;
}

async function waitExit(c: Child, ms: number): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (c.dead) return true;
    await sleep(100);
  }
  return c.dead;
}

function finish(): void {
  const failed = checks.filter((c) => !c.ok);
  say("\n=== 结论 ===");
  say(`${checks.length - failed.length}/${checks.length} 条通过`);
  for (const f of failed) say(`  ✗ ${f.name} — ${f.detail}`);
  const p1a = checks.filter((c) => c.name.startsWith("P1-a"));
  // 装载性一条没跑成（fork 就挂了）= No-Go，不许把「没测」当成「有条件通过」
  const go = p1a.length > 0 && p1a.every((c) => c.ok);
  if (FORM === "packaged" && !p1a.length) {
    // 打包态只跑到 P1-d 就停（child 入口未随包）——这是**打包资源缺口**，不是引擎可行性问题，
    // 不许写成 No-Go 误导后人；可行性结论以 dev 形态那次跑为准。
    say("打包形态结论：P1-d 未过 = 子进程入口未随包（T8.1 前置改动：拷进 out/ + asarUnpack）。**不改写 D 方案的 Go/No-Go**，可行性以 dev 形态跑批为准。");
  } else {
    say(failed.length === 0 ? "Go：utilityProcess 引擎路线可行性成立" : go ? "有条件 Go：装载性达标，其余项见失败清单（按 §8 记录后决定）" : "No-Go：装载性未达标，按退路回落「A + 每项目一活跃对话」并重写本节");
  }
  try {
    const dir = proofsDir();
    if (dir) {
      writeFileSync(join(dir, `engine-process-${FORM}.txt`), lines.join("\n") + "\n", "utf8");
      say(`（记录已写入 ${join(dir, `engine-process-${FORM}.txt`)}）`);
    }
  } catch {
    /* 写档失败不影响退出码 */
  }
  app.exit(failed.length === 0 ? 0 : go ? 2 : 1);
}
