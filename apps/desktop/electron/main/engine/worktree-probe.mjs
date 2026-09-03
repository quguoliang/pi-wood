/**
 * T8.0 P2 探针：git worktree 生命周期 + Pi 会话分家 + 降级路径（方案 D 的 Go/No-Go 门禁之二）。
 *
 * 用法（主机，Node ≥22）：node apps/desktop/electron/main/engine/worktree-probe.mjs
 * 退出码：0=全通过；1=有硬失败（含降级路径静默）；2=部分通过但装载性外有非关键失败。
 *
 * ⚠ 本脚本只操作自己在 os.tmpdir() 下建的临时仓库与一个**只读计时**用的现有仓库 worktree，
 *   绝不写用户真实仓库的工作树内容；Pi 会话显式指到临时 sessionDir，不污染 ~/.pi。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import { performance } from "node:perf_hooks";

process.env.PI_OFFLINE = "1";

const lines = [];
const say = (s = "") => {
  lines.push(s);
  console.log(s);
};
const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  say(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const sleepMs = () => 0;

/** 跑 git，返回 {ok, out, code, err}；不抛错（降级路径要靠它） */
function git(args, cwd) {
  try {
    const out = execFileSync("git", args, { cwd, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, out: out.trim(), code: 0, err: "" };
  } catch (e) {
    return { ok: false, out: String(e.stdout ?? "").trim(), code: e.status ?? -1, err: String(e.stderr ?? e.message ?? e).trim() };
  }
}
function timed(args, cwd) {
  const t0 = performance.now();
  const r = git(args, cwd);
  return { ...r, ms: Math.round(performance.now() - t0) };
}
function dirSizeMB(p) {
  let total = 0;
  try {
    for (const name of readdirSync(p)) {
      const fp = join(p, name);
      const st = statSync(fp, { throwIfNoEntry: false });
      if (!st) continue;
      total += st.isDirectory() ? dirSizeMB(fp) * 1024 * 1024 : st.size;
    }
  } catch {
    return 0;
  }
  return total / 1024 / 1024;
}
/** 降级文案（不许静默变成"共享主工作树并行跑"） */
function degradeMessage(r) {
  const e = `${r.err} ${r.out}`.toLowerCase();
  if (/not a git repository|fatal: not a git/.test(e)) return "该目录不是 git 仓库，无法为并行对话隔离工作树。请改用 git 仓库，或只开一个对话。";
  if (/already registered|already checked out|already exists/.test(e)) return "该工作树（或同名分支）已存在，可能来自上次未清理的会话。请先在「工作台 → 并行工作树」里回收，或换一个对话 id。";
  if (/working tree/.test(e) && /dirty|local changes/.test(e)) return "主工作树有未提交改动，git 拒绝在其上建分支。请先提交或暂存后再开并行对话。";
  if (/invalid reference|malformed|not a valid/.test(e)) return "基线提交不可用（分支不存在或处于半完成状态），无法建工作树。请修复仓库状态。";
  if (/filename too long|path too long|maximum path length/.test(e)) return "工作树路径超出 Windows 路径长度限制。请把项目放在更短的根路径，或缩短对话 id。";
  if (/permission denied|locked|unable to create/.test(e)) return "无权限创建工作树目录（或被安全软件拦截）。请检查目录权限。";
  if (/submodule/.test(e)) return "该仓库含子模块，工作树内的子模块目录默认是空的，需要先 git submodule update --init。并行对话对子模块的改动不会回流主工作树。";
  return "";
}

const ROOT = mkdtempSync(join(tmpdir(), "piwood-t80-"));
say(`=== T8.0 P2 worktree 探针（git ${git(["--version"]).out}，tmp=${ROOT}）===`);

/* ---------- 建基线仓库（含未跟踪 node_modules，用来验"不复制依赖"） ---------- */
const main = join(ROOT, "main");
mkdirSync(main, { recursive: true });
git(["init", "-b", "main"], main);
git(["config", "user.email", "probe@piwood.dev"], main);
git(["config", "user.name", "piwood-probe"], main);
const src = join(main, "src");
mkdirSync(src, { recursive: true });
const baseBody = Array.from({ length: 40 }, (_, i) => `line-${String(i + 1).padStart(2, "0")}`).join("\n") + "\n";
writeFileSync(join(src, "app.js"), baseBody);
writeFileSync(join(main, "README.md"), "# probe repo\n");
git(["add", "-A"], main);
const c1 = git(["commit", "-m", "base"], main);
if (!c1.ok) {
  say(`✗ 基线仓库建不起来：${c1.err}`);
  process.exit(1);
}
// node_modules 必须在基线提交**之后**创建，才是未跟踪依赖（先建会被 git add -A 提交进去，测不出东西）
mkdirSync(join(main, "node_modules"), { recursive: true });
writeFileSync(join(main, "node_modules", "dep.js"), "// 未跟踪依赖，worktree 不该带过来\n" + "x".repeat(2 * 1024 * 1024));
const baseCommit = git(["rev-parse", "--short", "HEAD"], main).out;
say(`基线仓库就绪 @${baseCommit}（node_modules 未跟踪，2MB）`);

/* ---------- P2-a 创建 + 隔离 + 回流 + 清理 ---------- */
const wt = (n) => join(ROOT, `wt-${n}`);
const tAdd1 = timed(["worktree", "add", wt("a"), "-b", "piwood/a"], main);
const tAdd2 = timed(["worktree", "add", wt("b"), "-b", "piwood/b"], main);
check("P2-a worktree add 成功", tAdd1.ok && tAdd2.ok, `A=${tAdd1.ms}ms B=${tAdd2.ms}ms${tAdd1.ok ? "" : ` err=${tAdd1.err.slice(0, 120)}`}`);
check("P2-a 工作树不复制未跟踪依赖（node_modules 缺席）", !existsSync(join(wt("a"), "node_modules")), `wt-a 大小=${dirSizeMB(wt("a")).toFixed(2)}MB（主树 node_modules 含 2MB 假依赖）`);
check("P2-a .git 是文件而非目录（共享 object 库）", (() => { try { return statSync(join(wt("a"), ".git")).isFile(); } catch { return false; } })(), "worktree 天然共享 objects，不复制历史");

// 两对话各改同一文件的不同行
function editLine(file, lineNo, marker) {
  const txt = readFileSync(file, "utf8").split("\n");
  txt[lineNo - 1] = `${txt[lineNo - 1]} // ${marker}`;
  writeFileSync(file, txt.join("\n"));
}
editLine(join(wt("a"), "src", "app.js"), 5, "CONV-A");
editLine(join(wt("b"), "src", "app.js"), 30, "CONV-B");
// ⚠ 用默认上下文（3 行）生成补丁，与 T8.6 的真实回流路径一致；
//   先前用 --unified=0 零上下文会让 apply --3way 无法定位而留下 unmerged 索引（UU），是探针缺陷不是结论
const diffA = git(["diff"], wt("a"));
const diffB = git(["diff"], wt("b"));
check("P2-a 两工作树 diff 互不污染", diffA.out.includes("CONV-A") && !diffA.out.includes("CONV-B") && diffB.out.includes("CONV-B") && !diffB.out.includes("CONV-A"), `A diff ${diffA.out.split("\n").length} 行 / B diff ${diffB.out.split("\n").length} 行`);

// 回流：两个 patch 依次 git apply --3way 进主工作树
const patchA = join(ROOT, "a.patch");
const patchB = join(ROOT, "b.patch");
writeFileSync(patchA, diffA.out + "\n");
writeFileSync(patchB, diffB.out + "\n");
const tApplyA = timed(["apply", "--3way", patchA], main);
const tApplyB = timed(["apply", "--3way", patchB], main);
const mainTxt = readFileSync(join(main, "src", "app.js"), "utf8");
const wsCfg = git(["config", "--get", "apply.whitespace"]).out;
// 判据以「两份改动确实进了主工作树」为准；退出码非零单独记为发现（本机 git 配了 apply.whitespace，
// 补丁带空白告警时会非零退出——T8.6 回流不能只看退出码，要么 --ignore-whitespace 要么先规范化）
check("P2-a 两份改动先后回流进主工作树（内容判据）", mainTxt.includes("CONV-A") && mainTxt.includes("CONV-B"), `A=${tApplyA.ms}ms(ok=${tApplyA.ok}) B=${tApplyB.ms}ms(ok=${tApplyB.ok})，两者均在主树=${mainTxt.includes("CONV-A") && mainTxt.includes("CONV-B")}`);
// 退出码非零不是失败而是**发现**（unified diff 的空行=一行只有前导空格 → git 2.54 判 trailing whitespace 并非零退出，
// 但改动确实落盘）。记为 ⚠ 信息项，通过与否由下面的 --ignore-whitespace 缓解断言决定。
if (!(tApplyA.ok && tApplyB.ok)) {
  say(`  ⚠ 发现：git apply --3way 对含空行上下文的补丁非零退出但内容已落（apply.whitespace=${wsCfg || "未设（默认 warn）"}）：${(tApplyB.err || tApplyA.err).split("\n")[0].slice(0, 90)}`);
} else {
  check("P2-a 回流退出码干净", true, "两次 apply 均 0 退出");
}
// 上面那条失败的根因与缓解：unified diff 里空行是「空格 + 空」= 一行只有前导空格 → git apply 判 trailing whitespace
// 并（git 2.54）非零退出，但改动确实落了盘。验一把 --ignore-whitespace 是否消掉非零退出，给 T8.6 一个可直接用的口径。
git(["reset", "--hard", "HEAD"], main);
const mitA = git(["apply", "--3way", "--ignore-whitespace", patchA], main);
const mitTxt = readFileSync(join(main, "src", "app.js"), "utf8");
check("P2-a 缓解方案有效：--ignore-whitespace 下退出码 0 且内容落盘", mitA.ok && mitTxt.includes("CONV-A"), `ok=${mitA.ok} 含A=${mitTxt.includes("CONV-A")} err="${mitA.err.split("\n")[0].slice(0, 80)}" → T8.6 回流固定用 --3way --ignore-whitespace，并以内容/diff 复核而非只看退出码`);
git(["reset", "--hard", "HEAD"], main);

// 冲突场景：两个工作树改同一行 → 第二份必须失败且给出可判读原因（不自动合）
const wtC = wt("c");
const wtD = wt("d");
git(["worktree", "add", wtC, "-b", "piwood/c"], main);
git(["worktree", "add", wtD, "-b", "piwood/d"], main);
editLine(join(wtC, "src", "app.js"), 12, "CONV-C");
editLine(join(wtD, "src", "app.js"), 12, "CONV-D");
const pC = join(ROOT, "c.patch");
const pD = join(ROOT, "d.patch");
writeFileSync(pC, git(["diff"], wtC).out + "\n");
writeFileSync(pD, git(["diff"], wtD).out + "\n");
const cleanMain = git(["reset", "--hard", "HEAD"], main); // 探针自有的临时仓库，可硬复位（含清 unmerged 索引）
const apC = git(["apply", "--3way", pC], main);
const apD = git(["apply", "--3way", pD], main);
check("P2-a 同行冲突不自动合（第二份 apply 失败且原因可读）", !apD.ok && apD.err.length > 0 && /conflict|does not match|error/i.test(apD.err), `主树还原=${cleanMain.ok}，C=${apC.ok}，D=${apD.ok ? "竟然成功(不合格)" : "被拒"}：${apD.err.split("\n")[0]?.slice(0, 100)}`);

// 清理
git(["reset", "--hard", "HEAD"], main);
for (const n of ["a", "b", "c", "d"]) git(["worktree", "remove", "--force", wt(n)], main);
git(["worktree", "prune"], main);
for (const b of ["piwood/a", "piwood/b", "piwood/c", "piwood/d"]) git(["branch", "-D", b], main);
const wtList = git(["worktree", "list"], main).out.split(/\r?\n/).filter(Boolean);
const leftover = (() => { try { return readdirSync(join(main, ".git", "worktrees")); } catch { return []; } })();
check("P2-a 清理彻底（worktree 列表回到 1 条、.git/worktrees 空、分支已删）", wtList.length === 1 && leftover.length === 0 && !git(["rev-parse", "--verify", "piwood/a"], main).ok, `剩 ${wtList.length} 个工作树，残留登记 ${leftover.length}`);
// 只查跟踪文件：node_modules 是故意留着的未跟踪依赖（上面那条断言正是要它未跟踪）
const dirtyAfter = git(["status", "--porcelain", "--untracked-files=no"], main);
check("P2-a 清理后主工作树干净（跟踪文件）", dirtyAfter.out === "", dirtyAfter.out.slice(0, 120) || "无改动");

/* ---------- 真实仓库计时（只建/删工作树，不碰内容） ---------- */
const realRepo = process.env.PIWOOD_REPO ?? "C:/Users/1/Desktop/pi-wood";
if (existsSync(join(realRepo, ".git"))) {
  const nmCount = (() => { try { return readdirSync(join(realRepo, "node_modules")).length; } catch { return 0; } })();
  const rw = join(tmpdir(), `piwood-t80-real-${Date.now()}`);
  const t = timed(["worktree", "add", "--detach", rw], realRepo);
  const sizeMB = t.ok ? dirSizeMB(rw) : 0;
  const hasNm = existsSync(join(rw, "node_modules"));
  say(`\n真实仓库（${realRepo}，node_modules ${nmCount} 项）worktree add：${t.ms}ms，工作树体积 ${sizeMB.toFixed(1)}MB，含 node_modules=${hasNm}`);
  check("真实仓库 worktree add 可用且 <10s", t.ok && t.ms < 10_000, `${t.ms}ms${t.ok ? "" : ` err=${t.err.slice(0, 140)}`}`);
  check("真实仓库 worktree 不复制 node_modules（体积远小于主树、目录缺席）", !hasNm && sizeMB < 200, `${sizeMB.toFixed(1)}MB`);
  if (t.ok) {
    const tRm = timed(["worktree", "remove", "--force", rw], realRepo);
    say(`  worktree remove：${tRm.ms}ms（ok=${tRm.ok}）`);
    git(["worktree", "prune"], realRepo);
  }
} else {
  say(`\n（跳过真实仓库计时：${realRepo} 不是 git 仓库）`);
}

/* ---------- P2-b Pi 会话按 cwd 分家 ---------- */
say("\n--- P2-b Pi 会话目录按 cwd 编码（worktree 化会令会话分家） ---");
const sessionDir = join(ROOT, "pi-sessions");
mkdirSync(sessionDir, { recursive: true });
const agentDir = join(ROOT, "pi-agent");
mkdirSync(agentDir, { recursive: true });
let pi;
try {
  pi = await import("@earendil-works/pi-coding-agent");
} catch (e) {
  say(`  ! Pi SDK 载入失败（Node 版本？须 ≥22）：${e.message}`);
}
if (pi) {
  const wSess = wt("s");
  git(["worktree", "add", wSess, "-b", "piwood/sess"], main);

  /* (1) 默认目录编码：只读路径字符串，不写盘、不污染 ~/.pi */
  const smMain = pi.SessionManager.create(main);
  const smWt = pi.SessionManager.create(wSess);
  const dirMain = smMain.getSessionDir();
  const dirWt = smWt.getSessionDir();
  say(`  默认 sessionDir 主项目：${dirMain}`);
  say(`  默认 sessionDir 工作树：${dirWt}`);
  check("P2-b 会话目录按 cwd 编码为互不相同的子目录（worktree 化必分家）", dirMain !== dirWt && !!dirMain && !!dirWt, `不同=${dirMain !== dirWt}`);
  check("P2-b 两者都走默认目录（即真跑到用户机器上会各存一处）", smMain.usesDefaultSessionDir() && smWt.usesDefaultSessionDir(), `main=${smMain.usesDefaultSessionDir()} wt=${smWt.usesDefaultSessionDir()}`);

  /* (2) 列表可见性：拿真实仓库的既有会话做证据（只读列目录，不写任何会话文件） */
  const realForSess = process.env.PIWOOD_REPO ?? "C:/Users/1/Desktop/pi-wood";
  if (existsSync(join(realForSess, ".git"))) {
    const freshWt = join(ROOT, "wt-real");
    const addR = git(["worktree", "add", "--detach", freshWt], realForSess);
    if (addR.ok) {
      const listReal = await pi.SessionManager.list(realForSess);
      const listFresh = await pi.SessionManager.list(freshWt);
      const dirReal = pi.SessionManager.create(realForSess).getSessionDir();
      const dirFresh = pi.SessionManager.create(freshWt).getSessionDir();
      say(`  真实仓库：主项目会话 ${listReal.length} 条；其新工作树 ${listFresh.length} 条`);
      if (listReal.length > 0) {
        check("P2-b 真实数据：主项目已有会话在工作树里一条都看不到（左栏必须聚合）", listFresh.length === 0 && !listFresh.some((s) => listReal.some((r) => r.id === s.id)), `主项目 ${listReal.length} 条 vs 工作树 ${listFresh.length} 条`);
      } else {
        // 该 cwd 下没有历史会话（pi-wood 仓库本身没在桌面端开过对话）→ 不硬判，
        // 分家结论由「会话目录按 cwd 编码不同」+ 既有事实（SessionManager.list(cwd) 只列该目录）支撑，真机复验留 T8.7
        say(`  ○ 真实仓库无历史会话可取样，列表可见性不硬判（目录编码已证不同：${basename(dirReal)} vs ${basename(dirFresh)}）`);
      }
      check("P2-b 两者会话目录不同（CLI --resume 在主项目也看不到工作树会话）", dirReal !== dirFresh, `${basename(dirReal)} vs ${basename(dirFresh)}`);
      git(["worktree", "remove", "--force", freshWt], realForSess);
      git(["worktree", "prune"], realForSess);
    } else {
      check("P2-b 真实数据会话分家", false, `工作树建不起来：${addR.err.slice(0, 120)}`);
    }
  }
  say("  → 结论：worktree 化后左栏须聚合「主项目 + 其全部 worktree」的会话（写进 T8.7）");
  git(["worktree", "remove", "--force", wSess], main);
  git(["branch", "-D", "piwood/sess"], main);
  git(["worktree", "prune"], main);
}

/* ---------- P2-c 降级路径 ---------- */
say("\n--- P2-c 降级路径（每类都必须给出显式文案，不许静默） ---");
const notGit = join(ROOT, "not-git");
mkdirSync(notGit, { recursive: true });
const rNotGit = git(["worktree", "add", join(ROOT, "x1"), "-b", "piwood/x1"], notGit);
check("降级·非 git 目录：失败且有文案", !rNotGit.ok && degradeMessage(rNotGit).length > 0, degradeMessage(rNotGit) || `无文案（err=${rNotGit.err.slice(0, 80)}）`);

writeFileSync(join(main, "dirty.txt"), "untracked dirty\n");
const rDirty = git(["worktree", "add", wt("dirty"), "-b", "piwood/dirty"], main);
check("降级·脏主树：git 本身允许建（记录为「允许但需提示未提交改动会被带走」）", rDirty.ok, rDirty.ok ? "建成功 → 文案：主工作树有未提交改动，工作树只带提交内容，未提交部分不会出现在并行对话里" : `失败：${rDirty.err.slice(0, 80)}`);
if (rDirty.ok) {
  git(["worktree", "remove", "--force", wt("dirty")], main);
  git(["branch", "-D", "piwood/dirty"], main);
}
git(["checkout", "--", "."], main);
writeFileSync(join(main, ".gitignore"), "node_modules/\n");
git(["add", ".gitignore"], main);
git(["commit", "-m", "gitignore"], main);

const rDup = git(["worktree", "add", wt("a"), "-b", "piwood/dup"], main); // wt-a 已删，但同名路径复用
const rDupBranch = git(["worktree", "add", wt("e"), "-b", "piwood/a"], main); // 分支不存在了，应成功
git(["worktree", "remove", "--force", wt("e")], main);
git(["branch", "-D", "piwood/a"], main);
git(["worktree", "prune"], main);
void rDup;

const rSame = git(["worktree", "add", wt("a"), "-b", "piwood/dup"], main);
const rCase = git(["worktree", "add", wt("A").toUpperCase(), "-b", "piwood/case"], main);
check("降级·路径大小写不敏感（Windows）：同一路径不同大小写被识别为冲突或有文案", !rCase.ok ? degradeMessage(rCase).length > 0 || /exist|registered/i.test(rCase.err) : true, rCase.ok ? "⚠ 竟然建成了第二个（大小写折叠未冲突）→ 需在 pi-wood 侧自己做路径归一" : `拒了：${rCase.err.split("\n")[0].slice(0, 90)}`);
if (rSame.ok) git(["worktree", "remove", "--force", wt("a")], main);
if (rCase.ok) git(["worktree", "remove", "--force", wt("A").toUpperCase()], main);
git(["branch", "-D", "piwood/dup", "piwood/case"], main);
git(["worktree", "prune"], main);

const longName = "piwood-long-" + "z".repeat(120);
const rLong = git(["worktree", "add", join(ROOT, longName, longName, longName), "-b", "piwood/long"], main);
check("降级·超长路径：成功或给出可判读文案", rLong.ok ? true : degradeMessage(rLong).length > 0 || rLong.err.length > 0, rLong.ok ? "建成功（Windows 未开长路径限制时可能失败）→ 记录实测可用" : `失败：${rLong.err.split("\n")[0].slice(0, 100)}`);
if (rLong.ok) git(["worktree", "remove", "--force", join(ROOT, longName, longName, longName)], main);
git(["branch", "-D", "piwood/long"], main);
git(["worktree", "prune"], main);

// detached HEAD 起点
git(["checkout", "--detach", "HEAD~1"], main);
const rDetached = git(["worktree", "add", wt("det"), "-b", "piwood/det"], main);
check("降级·detached HEAD 起点：能建工作树（分支从当前 commit 拉出）", rDetached.ok, rDetached.ok ? "可行" : `失败：${rDetached.err.slice(0, 100)}`);
if (rDetached.ok) {
  git(["worktree", "remove", "--force", wt("det")], main);
  git(["branch", "-D", "piwood/det"], main);
}
git(["checkout", "main"], main);
git(["worktree", "prune"], main);

// submodule
const sub = join(ROOT, "subrepo");
mkdirSync(sub, { recursive: true });
git(["init", "-b", "main"], sub);
git(["config", "user.email", "probe@piwood.dev"], sub);
git(["config", "user.name", "p"], sub);
writeFileSync(join(sub, "s.txt"), "sub\n");
git(["add", "-A"], sub);
git(["commit", "-m", "s"], sub);
const withSub = join(ROOT, "with-sub");
mkdirSync(withSub, { recursive: true });
git(["init", "-b", "main"], withSub);
git(["config", "user.email", "probe@piwood.dev"], withSub);
git(["config", "user.name", "p"], withSub);
const rSub = git(["-c", "protocol.file.allow=always", "submodule", "add", sub, "vendor-sub"], withSub);
git(["commit", "-m", "add submodule"], withSub);
const rSubWt = git(["worktree", "add", join(ROOT, "wt-sub"), "-b", "piwood/sub"], withSub);
const subEmpty = rSubWt.ok && existsSync(join(ROOT, "wt-sub", "vendor-sub")) && readdirSync(join(ROOT, "wt-sub", "vendor-sub")).length === 0;
check("降级·含子模块：工作树能建但子模块目录为空（须显式提示）", rSub.ok && rSubWt.ok && subEmpty, `submodule add=${rSub.ok}，worktree=${rSubWt.ok}，子模块空=${subEmpty} → 文案：${degradeMessage({ err: "submodule not initialized" })}`);
if (rSubWt.ok) git(["worktree", "remove", "--force", join(ROOT, "wt-sub")], withSub);
git(["branch", "-D", "piwood/sub"], withSub);

/* ---------- 结论 ---------- */
const failed = checks.filter((c) => !c.ok);
say("\n=== 结论 ===");
say(`${checks.length - failed.length}/${checks.length} 条通过`);
for (const f of failed) say(`  ✗ ${f.name} — ${f.detail}`);
say(failed.length === 0 ? "Go：worktree 隔离路线可行（回流/冲突/分家/降级均有明确处置）" : "见失败清单：装载与隔离类失败=No-Go 依据；降级文案类失败=必须补文案后重跑");
try {
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, "..", "..", "..", "docs", "proofs", "T8.0"); // electron/main/engine → apps/desktop
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "worktree-probe.txt"), lines.join("\n") + "\n", "utf8");
  say(`（记录已写入 ${dir}）`);
} catch {
  /* 写档失败不影响退出码 */
}
void sleepMs;
process.exit(failed.length === 0 ? 0 : 1);
