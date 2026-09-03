// 离线探针：测「多对话并发」的边际成本（执行计划 §7.9「探针实测」的数据来源）
//   A: 每会话一套 services（= 每对话一个 SdkAdapter 的成本）
//   B: 共享一套 services，只多造 session（SDK 官方分离点 createAgentSessionFromServices）
//
// 用法：HOME=/tmp/probehome N=6 node --expose-gc apps/desktop/scratch/multi-session-probe.mjs
// ⚠ 须 Node 22+（或在 Electron 主进程内跑）。Node 20 载不动本 SDK：`node:fs` 无 globSync、
//    undici@8 要 webidl.util.markAsUncloneable（同目录 fs-glob-shim.mjs 只能绕过第一项、第二项仍拦）。
// ⚠ 用空 HOME 跑 => **无社区扩展、无凭据、无 MCP**，tools=4 即内置工具，故测得的是**下界**。
//    真机（装了 pi-mcp-adapter / pi-web-access / pi-plan-mode）的每对话净增成本由 T8.0 复测。
// 2026-09-03 实测（linux-arm64 Node 22.14）：services 首次 20ms；此后每个会话 1~3ms、6 会话 RSS/heap 净增 0MB。
import { performance } from "node:perf_hooks";
const PI_OFFLINE = (process.env.PI_OFFLINE = "1");
const pi = await import("@earendil-works/pi-coding-agent");
const cwd = process.cwd();
const agentDir = pi.getAgentDir();

const mem = () => {
  const m = process.memoryUsage();
  return { rss: Math.round(m.rss / 1e6), heap: Math.round(m.heapUsed / 1e6) };
};
const gc = () => global.gc && global.gc();

function mb(n) { return Math.round(n / 1e6 * 10) / 10; }

async function makeServices(label) {
  const t0 = performance.now();
  const services = await pi.createAgentSessionServices({ cwd, agentDir });
  const t1 = performance.now();
  gc();
  console.log(`[services ${label}] create=${Math.round(t1 - t0)}ms mem=${JSON.stringify(mem())}`);
  return services;
}

async function makeSession(services, tag) {
  const t0 = performance.now();
  const sm = pi.SessionManager.create(cwd);
  const { session } = await pi.createAgentSessionFromServices({ services, sessionManager: sm });
  await session.bindExtensions({ uiContext: {}, mode: "rpc" });
  const t1 = performance.now();
  gc();
  console.log(`  [session ${tag}] create+bind=${Math.round(t1 - t0)}ms mem=${JSON.stringify(mem())} id=${session.sessionId} tools=${(session.getActiveToolNames?.() ?? []).length}`);
  return session;
}

const N = Number(process.env.N || 4);
console.log("=== 方案 B：共享 services ===");
const shared = await makeServices("shared");
const before = mem();
const sessions = [];
for (let i = 0; i < N; i++) sessions.push(await makeSession(shared, `B${i}`));
console.log(`B: 基线=${JSON.stringify(before)} N=${N} 总增 RSS=${mb(mem().rss - before.rss)}MB heap=${mb(mem().heap - before.heap)}MB`);

console.log("=== 方案 A：每会话独立 services ===");
const t0 = performance.now();
const ind = await makeServices("independent");
const { session } = await makeSession(ind, "A1");
console.log(`A: 一套 services+session 耗时=${Math.round(performance.now() - t0)}ms`);
console.log("DONE");
process.exit(0);
