import { app, BrowserWindow } from "electron";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureEngine, getActiveConversationIdSafe } from "./engine-manager";
import { getConversation } from "./conversation-registry";

/**
 * T9.2 上下文缩略树 v2 带窗交互探针 `electron . --context-tree-ui-probe`
 *
 * 无窗探针证到「数据与活链路」（树投影 / 按叶过滤 / navigateTree 真 child）；
 * 本探针补最后一段**渲染层闭环**：真窗口里起一条对话 → 会话文件写入构造的分叉
 * → engineSwitchSession 装载 → 在缩略树上**对人元素派发真 dblclick** →
 * 断言换底（transcript 只剩所选路径）、原文回填输入框、「回到最新」条出现/消失。
 * 截图留档 docs/proofs/ui-v3/context-tree-ui.png。
 *
 * 前提：settings.ui.contextTreeEnabled 默认 true；窗口可见。
 */
export function isContextTreeUiProbeMode(): boolean {
  return process.argv.includes("--context-tree-ui-probe");
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function makeGitProject(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `piwood-ctxui-${tag}-`));
  writeFileSync(join(dir, "README.md"), `# ctx ui probe ${tag}\n`, "utf-8");
  const run = (args: string[]): void => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  };
  run(["init", "-q"]);
  run(["config", "user.email", "probe@piwood.dev"]);
  run(["config", "user.name", "piwood-context-ui-probe"]);
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "probe base"]);
  return dir;
}

/** 与无窗探针同款分叉拓扑（题面带唯一 token，断言只认 token 避免树/正文串扰） */
function fixtureLines(cwd: string): string {
  const ts = (n: number): string => new Date(Date.UTC(2026, 8, 7, 0, 0, 0) + n * 60_000).toISOString();
  const header = { type: "session", version: 3, id: "sess-ctxui1", timestamp: ts(0), cwd };
  const user = (id: string, parentId: string | null, n: number, text: string): unknown => ({
    type: "message", id, parentId, timestamp: ts(n), message: { role: "user", content: text },
  });
  const asst = (id: string, parentId: string | null, n: number, text: string): unknown => ({
    type: "message", id, parentId, timestamp: ts(n), message: { role: "assistant", content: [{ type: "text", text }] },
  });
  const entries = [
    user("e00000u1", "sess-ctxui1", 1, "第一个问题 PROBE_COMMON_A1"),
    asst("e0000a11", "e00000u1", 2, "两分支共同的第一答"),
    user("e00000u2", "e0000a11", 3, "主干追问 PROBE_MAIN_QUESTION"),
    asst("e0000a21", "e00000u2", 4, "主干回答 MAIN_REPLY_Z7"),
    user("e00000ub", "e0000a11", 5, "换个思路的旁支问题 PROBE_BRANCH_QUESTION"),
    asst("e0000ab1", "e00000ub", 6, "旁支回答 BRANCH_REPLY_Z9"),
  ];
  return [header, ...entries].map((e) => JSON.stringify(e)).join("\n") + "\n";
}

let winRef: BrowserWindow | null = null;
async function js<T>(expr: string): Promise<T | undefined> {
  if (!winRef || winRef.isDestroyed()) return undefined;
  try {
    return (await winRef.webContents.executeJavaScript(`(() => { ${expr} })()`)) as T;
  } catch (err) {
    console.warn(`[ctx-ui] evaluate 失败：${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

function capture(file: string): Promise<void> {
  if (!winRef || winRef.isDestroyed()) return Promise.resolve();
  return winRef.webContents
    .capturePage()
    .then((image) => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, image.toPNG());
      console.log(`[ctx-ui] captured ${file}`);
    })
    .catch((err: unknown) => {
      console.warn(`[ctx-ui] 截图失败（不影响判定）：${err instanceof Error ? err.message : String(err)}`);
    });
}

export async function runContextTreeUiProbe(): Promise<void> {
  winRef = BrowserWindow.getAllWindows()[0] ?? null;
  const idx = process.argv.indexOf("--context-tree-ui-probe");
  const shot = process.argv[idx + 1] ?? join(app.getAppPath(), "docs", "proofs", "ui-v3", "context-tree-ui.png");
  const results: Array<{ name: string; ok: boolean; note: string }> = [];
  const check = (name: string, ok: boolean, note = ""): void => {
    results.push({ name, ok, note });
    console.log(`${ok ? "✓" : "✗"} ${name}${note ? ` — ${note}` : ""}`);
  };
  console.log("=== T9.2 --context-tree-ui-probe（带窗：旁支可见 / 双击换底 / 回填 / 回到最新） ===");
  let code = 1;
  try {
    if (!winRef) throw new Error("没有可用窗口（带窗探针必须以窗口形态运行）");

    // 1) 真对话装配（引擎 child + 注册表 + 会话文件）
    const proj = makeGitProject("a");
    const adapter = await ensureEngine(proj);
    const convId = getActiveConversationIdSafe();
    if (!convId) throw new Error("ensureEngine 后没有活跃对话");
    let sessionFile = getConversation(convId)?.record.sessionFile;
    if (!sessionFile) sessionFile = (await adapter.getState()).sessionFile;
    if (!sessionFile) throw new Error("拿不到该对话的会话文件路径");
    check("U0 真对话起活且会话文件已知", true, `conv=${convId.slice(0, 8)} file=${sessionFile.split("/").slice(-2).join("/")}`);

    // 2) 构造分叉写进该会话文件 → 走渲染层链路 engineSwitchSession（含注册表 sessionFile 同步）
    writeFileSync(sessionFile, fixtureLines(proj), "utf-8");
    // 树开关可能被用户设置关了：探针强制开（settingsSet 深合并，只动这一个键）
    await js<unknown>(`return window.pi.settingsSet({ ui: { contextTreeEnabled: true } }).then(() => true).catch(() => false);`);
    const switched = await js<boolean>(`return window.pi.engineSwitchSession(${JSON.stringify(sessionFile)}).then(() => true).catch(() => false);`);
    check("U0.1 engineSwitchSession 经渲染层链路成功（注册表同步）", switched === true, `switched=${String(switched)}`);
    await js<boolean>(`window.__piwoodSwitchConversation && window.__piwoodSwitchConversation(${JSON.stringify(convId)}); return true;`);

    // —— U0.5 诊断（不参与判定，只打印）：数据链哪一跳断了看这里 ——
    const diag = await js<Record<string, unknown>>(`
      const out = { hook: typeof window.__piwoodSwitchConversation };
      out.list = window.pi.listConversations().then((r) => {
        const rows = (r && r.conversations) || [];
        out.listConvs = rows.map((x) => x.id + ":" + x.status + ":" + String(x.sessionFile || "").split("/").pop());
        const mine = rows.find((x) => x.id === ${JSON.stringify(convId)});
        out.mineFile = mine && mine.sessionFile ? String(mine.sessionFile).split("/").pop() : null;
        return window.pi.sessionsMessages(mine ? mine.sessionFile : ${JSON.stringify(sessionFile)});
      }).then((msgs) => {
        out.msgCount = msgs.length;
        out.msgHeads = msgs.slice(0, 8).map((m) => m.role + ":" + String(m.text || "").slice(0, 12));
        return out;
      });
      return out.list.then(() => JSON.parse(JSON.stringify(out)));`)
      .catch(() => undefined);
    console.log(`[ctx-ui] diag=${JSON.stringify(diag)}`);

    // 等渲染层收敛：轮询 aside 出现（1.5s 轮询 + ensureHistoryLoaded + 树刷新，最多多等 8s）
    let asideSeen = false;
    for (let i = 0; i < 16 && !asideSeen; i += 1) {
      await sleep(500);
      asideSeen = await js<boolean>(`return !!document.querySelector('aside[aria-label="上下文缩略树"]');`) === true;
      if (!asideSeen && i === 8) {
        // 中途再切一次（对话行轮询可能滞后于 switchTo 首跑）
        await js<boolean>(`window.__piwoodSwitchConversation && window.__piwoodSwitchConversation(${JSON.stringify(convId)}); return true;`);
      }
    }

    // U1：树栏出现旁支行（主干被折叠在 #1 下），transcript = 默认叶（旁支尾）路径
    const u1 = await js<{ aside: boolean; treeHasMainBranch: boolean; bodyHasBranch: boolean; bodyHasMain: boolean; dump: string }>(`
      const aside = document.querySelector('aside[aria-label="上下文缩略树"]');
      return {
        aside: !!aside,
        treeHasMainBranch: !!aside && (aside.textContent || "").includes("主干追问"),
        bodyHasBranch: document.body.innerText.includes("BRANCH_REPLY_Z9"),
        bodyHasMain: document.body.innerText.includes("MAIN_REPLY_Z7"),
        dump: document.body.innerText.replace(/\\s+/g, " ").slice(0, 400),
      };`);
    check("U1.1 树栏渲染且旁支（主干）折叠可见", u1?.aside === true && u1?.treeHasMainBranch === true, u1?.aside ? `treeHasMainBranch=${u1.treeHasMainBranch}` : `dump=${JSON.stringify(u1?.dump ?? "")}`);
    check("U1.2 transcript=默认叶路径：见旁支答、不见主干答", u1?.bodyHasBranch === true && u1?.bodyHasMain === false, `branch=${u1?.bodyHasBranch} main=${u1?.bodyHasMain}`);

    // U2：双击旁支「主干追问」→ 换底 + 回填 + 回到最新条
    const dbl1 = await js<boolean>(`
      const aside = document.querySelector('aside[aria-label="上下文缩略树"]');
      if (!aside) return false;
      const btn = [...aside.querySelectorAll("button")].find((b) => (b.textContent || "").includes("主干追问"));
      if (!btn) return false;
      btn.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      return true;`);
    check("U2.0 找到旁支「主干追问」行并可派发 dblclick", dbl1 === true, "");
    await sleep(1800);
    const u2 = await js<{ common: boolean; bodyHasMain: boolean; bodyHasBranch: boolean; prefill: boolean; backBar: boolean; branchListFlipped: boolean }>(`
      const aside = document.querySelector('aside[aria-label="上下文缩略树"]');
      const ta = [...document.querySelectorAll("textarea")].find((t) => (t.value || "").includes("PROBE_MAIN_QUESTION"));
      return {
        common: document.body.innerText.includes("两分支共同的第一答"),
        bodyHasMain: document.body.innerText.includes("MAIN_REPLY_Z7"),
        bodyHasBranch: document.body.innerText.includes("BRANCH_REPLY_Z9"),
        prefill: !!ta,
        backBar: document.body.innerText.includes("正在查看历史分支"),
        branchListFlipped: !!aside && (aside.textContent || "").includes("换个思路"),
      };`);
    // SDK navigateTree 语义：目标是 user 条目 → leaf 挪到其**父**、原文回填输入框（检查点式「改这问重发」）。
    // 所以此刻 transcript = 公共前缀（u1/a1），主干与旁支的后续**都**不该在；被放弃的旁支反过来挂成旁支行。
    check(
      "U2.1 双击后换底到提问之前：公共前缀在、两支线文本消失、原问题回填、出现「回到最新」、旁支反向可见",
      u2?.common === true && u2?.bodyHasMain === false && u2?.bodyHasBranch === false && u2?.prefill === true && u2?.backBar === true && u2?.branchListFlipped === true,
      JSON.stringify(u2 ?? {}),
    );

    // U3：点「回到最新」→ 回默认叶（旁支），回到最新条消失
    const back = await js<boolean>(`
      const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("回到最新"));
      if (!btn) return false;
      btn.click();
      return true;`);
    check("U3.0 「回到最新」按钮可点", back === true, "");
    await sleep(1500);
    const u3 = await js<{ bodyHasBranch: boolean; bodyHasMain: boolean; backGone: boolean }>(`
      return {
        bodyHasBranch: document.body.innerText.includes("BRANCH_REPLY_Z9"),
        bodyHasMain: document.body.innerText.includes("MAIN_REPLY_Z7"),
        backGone: !document.body.innerText.includes("正在查看历史分支"),
      };`);
    check("U3.1 回到最新：transcript 回默认叶、指示条消失", u3?.bodyHasBranch === true && u3?.bodyHasMain === false && u3?.backGone === true, JSON.stringify(u3 ?? {}));

    await capture(shot);
    const failed = results.filter((r) => !r.ok).length;
    code = failed === 0 ? 0 : 1;
    console.log(`[ctx-ui] ${results.length - failed}/${results.length} 通过 · 结论 ${code === 0 ? "ALL PASS" : "FAIL"}`);
  } catch (err) {
    console.error(`[ctx-ui] 异常：${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    await capture(shot);
    code = 1;
  }
  await sleep(300);
  app.exit(code);
}
