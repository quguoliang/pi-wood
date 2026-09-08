import { app, BrowserWindow } from "electron";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureEngine, getActiveConversationIdSafe } from "./engine-manager";
import { getConversation } from "./conversation-registry";

/**
 * T9.2 v2.2 带窗交互探针 `electron . --context-tree-ui-probe`（形态按用户三轮改判定稿）：
 * 验证的是**消息刻度条 minimap（竖向居中 + 常态完全等长 + hover 正态展开 + 单条摘要浮层）**与**消息级分叉**：
 *   U1 刻度条出现、每个 user 轮次一个刻度、常态无摘要浮层、旧侧栏不存在；transcript=默认叶路径
 *      U1.1b 常态所有刻度 10×1px 一模一样——**不做默认高亮**（当前阅读轮也不例外）
 *   U2 hover 刻度：以目标为中心**正态展开**（目标 ≈20px 最长、邻居跟着变长但严格更短、远端回 10px），
 *      全程只有长度动不加粗；右侧 8px 只浮出**这一条**的摘要（diff bars + 首行标题，显式断言不含其他轮次）
 *   U3 点刻度 → 跳转 + 目标行 flash；指针离开后整列回到 10×1px 等长、浮层收起（无残留高亮）
 *   U4 回复底部「分叉」→ 新对话（含被点回复）+ 左栏「Fork of X」+ 底部「从对话中派生」chip；点 chip 回跳源对话
 *   U5 窄窗（<720px）刻度条自动隐藏、拉宽恢复
 * 截图留档 docs/proofs/ui-v3/context-tree-ui.png（+ hover 态 context-tree-ui-hover.png）。
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

/** 分叉拓扑：默认叶=旁支尾（transcript 4 条消息 = 2 个 user 刻度）；token 唯一防串扰 */
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
  console.log("=== T9.2 v2.1 --context-tree-ui-probe（minimap 刻度条 + 消息级分叉 + 派生回跳） ===");
  let code = 1;
  try {
    if (!winRef) throw new Error("没有可用窗口（带窗探针必须以窗口形态运行）");

    // 1) 真对话装配 → 写入分叉 fixture → 渲染层链路装载。
    //    临时项目先注册进项目列表：左栏对话行（含「Fork of」别名断言）只渲染已注册项目的对话。
    const proj = makeGitProject("a");
    await js<boolean>(`return window.pi.projectAdd(${JSON.stringify(proj)}).then(() => true).catch(() => false);`);
    const adapter = await ensureEngine(proj);
    const convId = getActiveConversationIdSafe();
    if (!convId) throw new Error("ensureEngine 后没有活跃对话");
    let sessionFile = getConversation(convId)?.record.sessionFile;
    if (!sessionFile) sessionFile = (await adapter.getState()).sessionFile;
    if (!sessionFile) throw new Error("拿不到该对话的会话文件路径");
    check("U0 真对话起活且会话文件已知", true, `conv=${convId.slice(0, 8)}`);

    writeFileSync(sessionFile, fixtureLines(proj), "utf-8");
    const switched = await js<boolean>(`return window.pi.engineSwitchSession(${JSON.stringify(sessionFile)}).then(() => true).catch(() => false);`);
    check("U0.1 engineSwitchSession 经渲染层链路成功", switched === true, `switched=${String(switched)}`);

    // 视图收敛：每轮补 switchTo（App 启动期草稿恢复会抢视图——09-07 实测），等 minimap 挂载
    let minimapSeen = false;
    for (let i = 0; i < 24 && !minimapSeen; i += 1) {
      await sleep(500);
      await js<boolean>(`window.__piwoodSwitchConversation && window.__piwoodSwitchConversation(${JSON.stringify(convId)}); return true;`);
      minimapSeen = await js<boolean>(`return !!document.querySelector('[data-minimap]');`) === true;
    }

    // U1：刻度条 2 个 user 刻度（v2.2：assistant 不成刻度）+ 面板默认不渲染 + 旧侧栏不存在；transcript=旁支路径
    const u1 = await js<{
      minimap: boolean;
      ticks: number;
      lines: Array<{ width: number; height: number }>;
      tipAbsent: boolean;
      asideGone: boolean;
      bodyHasBranch: boolean;
      bodyHasMain: boolean;
    }>(`
      const mm = document.querySelector('[data-minimap]');
      const lines = mm ? [...mm.querySelectorAll('[data-message-nav="compact"] [data-tick-line]')] : [];
      return {
        minimap: !!mm,
        ticks: mm ? mm.querySelectorAll('[data-message-nav="compact"] button[data-tick]').length : 0,
        lines: lines.map((el) => {
          const r = el.getBoundingClientRect();
          return { width: r.width, height: r.height };
        }),
        tipAbsent: !document.querySelector('[data-minimap] [data-nav-tip]'),
        asideGone: !document.querySelector('aside[aria-label="上下文缩略树"]'),
        bodyHasBranch: document.body.innerText.includes("BRANCH_REPLY_Z9"),
        bodyHasMain: document.body.innerText.includes("MAIN_REPLY_Z7"),
      };`);
    check(
      "U1.1 刻度条出现、默认叶路径 2 个 user 刻度、常态无摘要浮层、旧侧栏已移除",
      u1?.minimap === true && u1?.ticks === 2 && u1?.tipAbsent === true && u1?.asideGone === true,
      JSON.stringify(u1 ?? {}),
    );
    check(
      "U1.1b 常态无默认高亮：所有刻度 10×1px 完全一样（当前轮也不例外）",
      !!u1 && u1.lines.length === 2 && u1.lines.every((l) => l.width <= 11 && l.height <= 1.5),
      `lines=${JSON.stringify(u1?.lines ?? [])}`,
    );
    check("U1.2 transcript=默认叶路径：见旁支答、不见主干答", u1?.bodyHasBranch === true && u1?.bodyHasMain === false, "");

    // U2：hover 第 2 个刻度（旁支问题）→ 正态展开（目标最长、邻居次之）+ 右侧只浮「这一条」的摘要
    await js<boolean>(`
      const mm = document.querySelector('[data-minimap]');
      const tick = mm.querySelectorAll('[data-message-nav="compact"] button[data-tick]')[1];
      if (!tick) return false;
      tick.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      return true;`);
    await sleep(400);
    const u2 = await js<{
      ticks: Array<{ width: number; height: number }>;
      tipCount: number;
      tipText: string;
      tipBars: number;
      tipRightOfRail: boolean;
      tipAlignedToHovered: boolean;
    }>(`
      const mm = document.querySelector('[data-minimap]');
      const rail = mm.querySelector('[data-message-nav="compact"]');
      const ticks = [...mm.querySelectorAll('[data-message-nav="compact"] button[data-tick]')];
      const tips = [...mm.querySelectorAll('[data-nav-tip]')];
      const tip = tips[0];
      const railRight = rail.getBoundingClientRect().right;
      const line = ticks[1] ? ticks[1].querySelector('[data-tick-line]').getBoundingClientRect() : null;
      const t = tip ? tip.getBoundingClientRect() : null;
      return {
        ticks: ticks.map((el) => {
          const r = el.querySelector('[data-tick-line]').getBoundingClientRect();
          return { width: r.width, height: r.height };
        }),
        tipCount: tips.length,
        tipText: tip ? tip.innerText : "",
        tipBars: tip ? tip.querySelectorAll("svg[data-diff-bars] rect").length : 0,
        tipRightOfRail: t ? t.left >= railRight : false,
        tipAlignedToHovered: !!(t && line) && Math.abs(t.top + t.height / 2 - (line.top + line.height / 2)) <= 3,
      };`);
    // 正态展开：目标最长（≈20px）、邻居跟着变长但严格更短、远端回 base；全程只有长度动，粗细不变。
    const target = u2?.ticks[1];
    const neighbour = u2?.ticks[0];
    check(
      "U2 hover 正态展开：目标最长 > 邻居 > 常态 10px，且都不加粗；摘要浮层贴目标右侧并对齐",
      !!target && !!neighbour &&
        target.width >= 19.5 &&
        neighbour.width > 15 &&
        neighbour.width < target.width - 1 &&
        u2.ticks.every((t) => t.height <= 1.5) &&
        u2.tipCount === 1 && u2.tipRightOfRail === true && u2.tipAlignedToHovered === true,
      JSON.stringify(u2 ?? {}),
    );
    check(
      "U2.1 浮层只展示当前这一条（标题 + 5 根 bars），不列其他轮次",
      !!u2 && u2.tipText.includes("换个思路") && !u2.tipText.includes("第一个问题") && u2.tipBars === 5,
      `tip=${JSON.stringify(u2?.tipText ?? "")} bars=${String(u2?.tipBars ?? -1)}`,
    );
    // hover 摘要态留一张证据图（末帧 capture 时浮层已收）
    await capture(join(dirname(shot), "context-tree-ui-hover.png"));

    // U3：点第 1 个刻度 → 跳转 + flash 高亮；指针离开后整列回到等长（无残留高亮）
    await js<boolean>(`
      const mm = document.querySelector('[data-minimap]');
      const prev = mm.querySelectorAll('[data-message-nav="compact"] button[data-tick]')[1];
      prev.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })); // 清掉 U2 残留的 hover 展开
      return true;`);
    await sleep(300);
    await js<boolean>(`
      const mm = document.querySelector('[data-minimap]');
      const tick = mm.querySelectorAll('[data-message-nav="compact"] button[data-tick]')[0];
      if (!tick) return false;
      tick.click();
      return true;`);
    await sleep(700);
    const u3 = await js<boolean>(`return !!document.querySelector('[class*="ring-ring"]');`);
    check("U3 点刻度跳转：目标行出现 flash 高亮", u3 === true, "");
    await js<boolean>(`
      const mm = document.querySelector('[data-minimap]');
      const tick = mm.querySelectorAll('[data-message-nav="compact"] button[data-tick]')[0];
      tick.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      return true;`);
    await sleep(700); // 120ms 收起延迟 + 200ms 回弹过渡
    const u3rest = await js<{ lines: Array<{ width: number; height: number }>; tipGone: boolean }>(`
      const mm = document.querySelector('[data-minimap]');
      const lines = [...mm.querySelectorAll('[data-message-nav="compact"] [data-tick-line]')];
      return {
        lines: lines.map((el) => {
          const r = el.getBoundingClientRect();
          return { width: r.width, height: r.height };
        }),
        tipGone: !document.querySelector('[data-minimap] [data-nav-tip]'),
      };`);
    check(
      "U3.1 指针离开后整列回到 10×1px 等长、浮层收起（不留任何高亮）",
      !!u3rest && u3rest.lines.length === 2 && u3rest.lines.every((l) => l.width <= 11 && l.height <= 1.5) && u3rest.tipGone === true,
      JSON.stringify(u3rest ?? {}),
    );

    // U4（v2.1 语义改判）：最后一条回复底部「分叉」→ 新对话**含被点回复本身**（整条旁支路径
    // u1/a1/ub/ab1 全量拷贝）+ Fork of 别名 + 派生 chip；点 chip 回跳源对话；再验「轮中分叉」。
    const forkClicked = await js<boolean>(`
      const btns = [...document.querySelectorAll('[aria-label="分叉"]')];
      if (!btns.length) return false;
      btns[btns.length - 1].click();
      return true;`);
    check("U4.0 回复底部「分叉」按钮可点", forkClicked === true, "");
    let u4 = { convCount: 0, hasQuestion: false, hasReply: false, chip: false, aliasOk: false };
    for (let i = 0; i < 24; i += 1) {
      await sleep(1000);
      u4 =
        (await js<typeof u4>(`
          const out = { convCount: 0, hasQuestion: false, hasReply: false, chip: false, aliasOk: false };
          return window.pi.listConversations().then((r) => {
            out.convCount = ((r && r.conversations) || []).length;
            const body = document.body.innerText;
            out.hasQuestion = body.includes("换个思路的旁支问题");
            out.hasReply = body.includes("BRANCH_REPLY_Z9");
            out.chip = !!document.querySelector('[data-forked-from]');
            // 左栏项目默认折叠、对话行不渲染——别名断言走数据契约（sessions:meta 落盘值），
            // 「alias ?? 首条消息」的行渲染路径 T8.11 已证。
            const forkedFile = (((r && r.conversations) || []).find((c) => c.id !== ${JSON.stringify(convId)}) || {}).sessionFile;
            return window.pi.sessionsMeta().then((m) => {
              out.aliasOk = !!(forkedFile && m[forkedFile] && String(m[forkedFile].alias || "").startsWith("Fork of") && m[forkedFile].forkedFrom);
              return out;
            });
          });`)) ?? u4;
      if (u4.convCount === 2 && u4.hasQuestion && u4.hasReply && u4.chip && u4.aliasOk) break;
    }
    check(
      "U4.1 末尾分叉：新对话含被点回复（整路径拷贝）+ 派生 chip + 别名/forkedFrom 落盘",
      u4.convCount === 2 && u4.hasQuestion === true && u4.hasReply === true && u4.chip === true && u4.aliasOk === true,
      JSON.stringify(u4),
    );
    const chipClicked = await js<boolean>(`
      const chip = document.querySelector('[data-forked-from]');
      if (!chip) return false;
      chip.click();
      return true;`);
    await sleep(1800);
    const u4back = await js<boolean>(`
      return document.body.innerText.includes("BRANCH_REPLY_Z9") && !document.querySelector('[data-forked-from]');`);
    check("U4.2 点「从对话中派生」回跳源对话（源对话无 chip）", chipClicked === true && u4back === true, `back=${String(u4back)}`);

    // U4.3 轮中分叉：点第一条回复（a11）的分叉 → 新对话 = 第一轮 Q&A，不含第二轮（含其提问）
    const forkFirst = await js<boolean>(`
      const btns = [...document.querySelectorAll('[aria-label="分叉"]')];
      if (!btns.length) return false;
      btns[0].click();
      return true;`);
    let u43 = { convCount: 0, hasFirst: false, noSecond: false, chip: false };
    for (let i = 0; i < 24; i += 1) {
      await sleep(1000);
      u43 =
        (await js<typeof u43>(`
          const out = { convCount: 0, hasFirst: false, noSecond: false, chip: false };
          return window.pi.listConversations().then((r) => {
            out.convCount = ((r && r.conversations) || []).length;
            const body = document.body.innerText;
            out.hasFirst = body.includes("两分支共同的第一答");
            out.noSecond = !body.includes("换个思路的旁支问题") && !body.includes("BRANCH_REPLY_Z9");
            out.chip = !!document.querySelector('[data-forked-from]');
            return out;
          });`)) ?? u43;
      if (u43.convCount === 3 && u43.hasFirst && u43.noSecond && u43.chip) break;
    }
    check(
      "U4.3 轮中分叉：新对话只含第一轮完整 Q&A（含被点回复、不含后续）",
      forkFirst === true && u43.convCount === 3 && u43.hasFirst === true && u43.noSecond === true && u43.chip === true,
      JSON.stringify(u43),
    );

    // U5 前置：视图此时停在「轮中分叉」的新对话（只有 1 个 user 轮 → 参考形态下刻度条本就不渲染），
    //      先切回原对话（2 个 user 轮）再验窄窗，免得把「按设计不出现」误判成隐藏逻辑坏了。
    let backToSource = false;
    for (let i = 0; i < 20 && !backToSource; i += 1) {
      await sleep(500);
      await js<boolean>(`window.__piwoodSwitchConversation && window.__piwoodSwitchConversation(${JSON.stringify(convId)}); return true;`);
      backToSource = (await js<boolean>(`return !!document.querySelector('[data-minimap]');`)) === true;
    }

    // U5：窄窗自动隐藏（临时放开 minWidth 钳制，测完还原）
    const win = winRef;
    const bounds = win.getBounds();
    win.setMinimumSize(640, 480);
    win.setBounds({ ...bounds, width: 760 });
    await sleep(700);
    const u5narrow = await js<string>(`
      const mm = document.querySelector('[data-minimap]');
      return mm ? getComputedStyle(mm).visibility : "missing";`);
    win.setMinimumSize(960, 600);
    win.setBounds(bounds);
    // 拉宽后轮询到 visible 为止（AppShell 列宽有 260ms 过渡 + GSAP 帧，单次测量会撞在动画中途误报）
    let u5wide = "missing";
    for (let i = 0; i < 10; i += 1) {
      await sleep(300);
      u5wide =
        (await js<string>(`
          const mm = document.querySelector('[data-minimap]');
          return mm ? getComputedStyle(mm).visibility : "missing";`)) ?? "missing";
      if (u5wide === "visible") break;
    }
    check("U5 窄窗自动隐藏、拉宽恢复", u5narrow === "hidden" && u5wide === "visible", `narrow=${u5narrow} wide=${u5wide} back=${String(backToSource)}`);

    // 清理：解除临时项目注册（探针不留在册痕迹；对话随应用退出自然消散）
    await js<boolean>(`
      return window.pi.projectList().then((list) => {
        const rec = (list && list.projects ? list.projects : list || []).find((p) => p.path === ${JSON.stringify(proj)});
        return rec ? window.pi.projectRemove(rec.id).then(() => true) : true;
      }).catch(() => false);`);

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
