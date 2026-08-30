// T1.4 后台验证：ProjectManager + SessionService 对真实 ~/.pi 数据
// 运行：node scratch/backend-probe.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectManager } from "../electron/main/project/project-manager.ts";
import { listSessions, openSessionTree } from "../electron/main/engine/session-service.ts";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const CWD = join(dirname(fileURLToPath(import.meta.url)), "test-project");

// 1) ProjectManager（临时注册表，不污染真实 ~/.pi-desktop）
const tmp = mkdtempSync(join(tmpdir(), "pidesk-probe-"));
const pm = new ProjectManager(tmp, getAgentDir());
const rec = pm.add(CWD);
pm.add("C:\\some\\other\\project");
console.log("[pm] list:", pm.list().map((p) => `${p.name}(${p.id})`));
console.log("[pm] trustStatus(test-project):", await pm.trustStatus(CWD));
console.log("[pm] trustStatus(无 .pi 目录):", await pm.trustStatus(tmpdir()));
pm.remove("C:\\some\\other\\project");
console.log("[pm] after remove:", pm.list().length, "projects");
console.log("[pm] touch:", pm.touch(CWD).lastOpenedAt !== rec.addedAt ? "updated" : "unchanged");

// 2) SessionService：真实会话数据
const sessions = await listSessions(CWD);
console.log(`[sessions] ${sessions.length} 个（按修改时间序）:`);
for (const s of sessions.slice(0, 5)) {
  console.log(`  - ${s.file.split(/[\\/]/).pop()} msgs=${s.messageCount} first="${s.firstMessage.slice(0, 40)}"`);
}

const latest = sessions[0];
if (latest) {
  const tree = await openSessionTree(latest.file);
  console.log(`[tree] session=${tree.sessionId} entries=${tree.totalEntries} defaultLeaf=${tree.defaultLeafId}`);
  for (const row of tree.rows.slice(0, 14)) {
    const indent = "  ".repeat(row.depth);
    const branch = row.activeBranch ? "*" : " ";
    console.log(`  ${branch}${indent}${row.type} [${row.id}]`);
  }
  if (tree.rows.length > 14) console.log(`  … 共 ${tree.rows.length} 行`);
}

rmSync(tmp, { recursive: true, force: true });
console.log("[probe] DONE");
