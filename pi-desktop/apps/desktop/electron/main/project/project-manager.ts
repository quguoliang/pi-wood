import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ProjectTrustStore, hasTrustRequiringProjectResources } from "@earendil-works/pi-coding-agent";

/**
 * 项目注册表（T1.4 左栏 <ProjectPane> 数据层）。
 * - 注册表：~/.pi-desktop/projects.json（应用侧 UI 状态，与 Pi 配置分离，方案 §8.1）
 * - 信任：复用 Pi ProjectTrustStore（agentDir/trust.json），不自建信任体系（方案 §5.2/§9）
 */
export interface ProjectRecord {
  id: string;
  path: string;
  name: string;
  addedAt: string;
  lastOpenedAt: string;
}

export type TrustStatus = "trusted" | "untrusted" | "undecided" | "not-required";

export function projectIdFor(path: string): string {
  return createHash("sha1").update(path.toLowerCase()).digest("hex").slice(0, 12);
}

interface RegistryFile {
  projects: ProjectRecord[];
}

export class ProjectManager {
  private registryPath: string;
  private trustStore: ProjectTrustStore;

  constructor(appDataDir: string, agentDir: string) {
    this.registryPath = join(appDataDir, "projects.json");
    this.trustStore = new ProjectTrustStore(agentDir);
    if (!existsSync(this.registryPath)) {
      mkdirSync(dirname(this.registryPath), { recursive: true });
      writeFileSync(this.registryPath, JSON.stringify({ projects: [] }, null, 2));
    }
  }

  private read(): RegistryFile {
    try {
      return JSON.parse(readFileSync(this.registryPath, "utf-8")) as RegistryFile;
    } catch {
      return { projects: [] };
    }
  }

  private write(reg: RegistryFile): void {
    mkdirSync(dirname(this.registryPath), { recursive: true });
    writeFileSync(this.registryPath, JSON.stringify(reg, null, 2));
  }

  list(): ProjectRecord[] {
    return this.read().projects.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  }

  get(path: string): ProjectRecord | undefined {
    const id = projectIdFor(path);
    return this.read().projects.find((p) => p.id === id);
  }

  add(path: string): ProjectRecord {
    const reg = this.read();
    const id = projectIdFor(path);
    const existing = reg.projects.find((p) => p.id === id);
    if (existing) return this.touch(path);
    const now = new Date().toISOString();
    const record: ProjectRecord = {
      id,
      path,
      name: dirname(path) === path ? path : path.split(/[\\/]/).filter(Boolean).pop() ?? path,
      addedAt: now,
      lastOpenedAt: now,
    };
    reg.projects.push(record);
    this.write(reg);
    return record;
  }

  remove(idOrPath: string): boolean {
    const reg = this.read();
    const id = projectIdFor(idOrPath);
    const before = reg.projects.length;
    reg.projects = reg.projects.filter((p) => p.id !== id && p.path !== idOrPath);
    this.write(reg);
    return reg.projects.length < before;
  }

  touch(path: string): ProjectRecord {
    const reg = this.read();
    const id = projectIdFor(path);
    const record = reg.projects.find((p) => p.id === id);
    if (!record) throw new Error(`project not registered: ${path}`);
    record.lastOpenedAt = new Date().toISOString();
    this.write(reg);
    return record;
  }

  /** 信任预检（徽标/TrustDialog 用）。运行中的实际信任交互仍由 Pi project_trust 事件经 uiBridge 完成 */
  trustStatus(cwd: string): TrustStatus {
    if (!existsSync(join(cwd, ".pi"))) return "not-required";
    if (!hasTrustRequiringProjectResources(cwd)) return "not-required";
    // ProjectTrustDecision = boolean | null：true=已信任 / false=已拒绝 / null=未决策
    const decision = this.trustStore.get(cwd);
    if (decision === true) return "trusted";
    if (decision === false) return "untrusted";
    return "undecided";
  }
}

export const DEFAULT_APP_DATA_DIR = join(
  process.env["USERPROFILE"] ?? process.env["HOME"] ?? ".",
  ".pi-desktop",
);
