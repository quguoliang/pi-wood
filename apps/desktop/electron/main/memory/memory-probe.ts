import { app } from "electron";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureMemoryService } from "./memory-service.ts";

/**
 * T7.10 Agent Memory headless 探针（仿 goal/plugin probe）。
 * 注入临时目录（appDataDir + 可切换的 projectDir）跑真 MemoryService（真 fs 落盘），断言：
 * global/project 分文件、reviewed 转正、同标题 upsert 不新增、project scope 按活动项目隔离、删除。
 * 触发：electron out/main/index.js --memory-probe   （EXIT 0=全过 / 1=失败）
 */
export function isMemoryProbeMode(): boolean {
  return process.argv.includes("--memory-probe");
}

const line = (tag: string, msg: string): void => console.log(`[memory-probe] ${tag} ${msg}`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function runMemoryProbe(): Promise<void> {
  const results: Array<{ pass: boolean; name: string; detail: string }> = [];
  const check = (name: string, pass: boolean, detail: string): void => {
    results.push({ name, pass, detail });
    line(pass ? "✓" : "✗", `${name} — ${detail}`);
  };

  try {
    const root = mkdtempSync(join(tmpdir(), "pi-wood-mem-probe-"));
    const appData = join(root, "appdata");
    const projA = join(root, "projA");
    const projB = join(root, "projB");
    mkdirSync(projA, { recursive: true });
    mkdirSync(projB, { recursive: true });
    let curProject = projA;
    const svc = configureMemoryService({ appDataDir: appData, getProjectDir: () => curProject });

    // ① global 保存 → 落 global.json + list 可见 + reviewed:false
    const g = svc.save({ title: "偏好", body: "用 pnpm", scope: "global", type: "preference" });
    check("global 保存", g.ok && g.item?.reviewed === false && existsSync(join(appData, "memory", "global.json")), `id=${g.item?.id} reviewed=${g.item?.reviewed}`);

    // ② project 保存 → 落 projA/.pi-wood/memory/project.json + project list
    const p = svc.save({ title: "本项目 lint", body: "用 eslint", scope: "project" });
    check(
      "project 保存 + 落项目内文件",
      p.ok && existsSync(join(projA, ".pi-wood", "memory", "project.json")) && svc.list().project.length === 1,
      `projectCount=${svc.list().project.length}`,
    );

    // ③ reviewed 转正
    check("确认→reviewed", g.item ? svc.markReviewed(g.item.id, true) && svc.list().global[0]?.reviewed === true : false, "");

    // ④ 同标题 upsert 不新增
    svc.save({ title: "偏好", body: "改用 pnpm（更新）", scope: "global" });
    check("同标题 upsert 不新增、内容更新、reviewed 复位", svc.list().global.length === 1 && svc.list().global[0]?.body.includes("更新") && svc.list().global[0]?.reviewed === false, `globalCount=${svc.list().global.length}`);

    // ⑤ project scope 按活动项目隔离：切到 projB → project 记忆清空、global 仍在
    curProject = projB;
    const afterSwitch = svc.list();
    check("project scope 隔离（切项目后不可见）", afterSwitch.project.length === 0 && afterSwitch.global.length === 1, `projB project=${afterSwitch.project.length} global=${afterSwitch.global.length}`);
    curProject = projA;
    check("切回 projA 其 project 记忆仍在", svc.list().project.length === 1, "");

    // ⑥ 删除
    const pid = p.item?.id ?? "";
    check("删除生效", !!pid && svc.remove(pid) && svc.list().project.length === 0, "");
  } catch (e) {
    check("异常", false, e instanceof Error ? e.stack ?? e.message : String(e));
  }

  const allPass = results.length > 0 && results.every((r) => r.pass);
  line("=", `${results.filter((r) => r.pass).length}/${results.length} 通过 · 结论 ${allPass ? "ALL PASS" : "FAIL"}`);
  await sleep(200);
  app.exit(allPass ? 0 : 1);
}
