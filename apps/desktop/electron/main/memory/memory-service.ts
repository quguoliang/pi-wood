import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  addItem,
  deleteById,
  parseItems,
  renderForAgent,
  serializeItems,
  setReviewed,
  updateItem,
  type MemoryItem,
  type NewMemoryInput,
} from "./store.ts";

/**
 * T7.10 Agent Memory 存储/服务层（fs 落盘 + scope 路由）。纯裁剪逻辑在 store.ts。
 * global → ~/.pi-wood/memory/global.json；project → <projectDir>/.pi-wood/memory/project.json。
 * project scope 依赖「当前活动项目目录」（由注入的 getProjectDir 提供），agent 不能指定项目 id。
 */

export interface MemoryServiceDeps {
  appDataDir: string; // ~/.pi-wood
  getProjectDir(): string | undefined; // 当前活动项目根
}

export interface SaveResult {
  ok: boolean;
  item: MemoryItem | null;
  created: boolean;
  error?: string;
}

export class MemoryService {
  constructor(private deps: MemoryServiceDeps) {}

  private globalFile(): string {
    return join(this.deps.appDataDir, "memory", "global.json");
  }
  private projectFile(projectDir: string): string {
    return join(projectDir, ".pi-wood", "memory", "project.json");
  }

  private readGlobal(): MemoryItem[] {
    const p = this.globalFile();
    return parseItems(existsSync(p) ? this.safeRead(p) : "");
  }
  private readProject(): MemoryItem[] {
    const dir = this.deps.getProjectDir();
    if (!dir) return [];
    const p = this.projectFile(dir);
    return parseItems(existsSync(p) ? this.safeRead(p) : "");
  }
  private safeRead(p: string): string {
    try {
      return readFileSync(p, "utf-8");
    } catch {
      return "";
    }
  }
  private writeGlobal(items: MemoryItem[]): void {
    this.write(this.globalFile(), items);
  }
  private writeProject(items: MemoryItem[]): void {
    const dir = this.deps.getProjectDir();
    if (dir) this.write(this.projectFile(dir), items);
  }
  private write(p: string, items: MemoryItem[]): void {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, serializeItems(items), "utf-8");
  }

  /** 定位一个 id 落在哪个 scope（global 优先），供 delete/review/read/update。 */
  private locate(id: string): "global" | "project" | null {
    if (this.readGlobal().some((m) => m.id === id)) return "global";
    if (this.readProject().some((m) => m.id === id)) return "project";
    return null;
  }

  list(): { global: MemoryItem[]; project: MemoryItem[] } {
    return { global: this.readGlobal(), project: this.readProject() };
  }

  renderForAgent(): string {
    const { global, project } = this.list();
    return renderForAgent(global, project);
  }

  save(input: NewMemoryInput): SaveResult {
    const scope = input.scope === "project" ? "project" : "global";
    if (scope === "project" && !this.deps.getProjectDir()) {
      return { ok: false, item: null, created: false, error: "project scope 需要先选择项目；请改用 global 或先选项目" };
    }
    const items = scope === "project" ? this.readProject() : this.readGlobal();
    const r = addItem(items, { ...input, scope });
    if (!r.item) return { ok: false, item: null, created: false, error: r.error ?? "保存失败" };
    if (scope === "project") this.writeProject(r.items);
    else this.writeGlobal(r.items);
    return { ok: true, item: r.item, created: r.created };
  }

  read(id: string): MemoryItem | null {
    const at = this.locate(id);
    if (!at) return null;
    const list = at === "global" ? this.readGlobal() : this.readProject();
    return list.find((m) => m.id === id) ?? null;
  }

  remove(id: string): boolean {
    const at = this.locate(id);
    if (!at) return false;
    if (at === "global") {
      const r = deleteById(this.readGlobal(), id);
      if (r.removed) this.writeGlobal(r.items);
      return r.removed;
    }
    const r = deleteById(this.readProject(), id);
    if (r.removed) this.writeProject(r.items);
    return r.removed;
  }

  markReviewed(id: string, reviewed: boolean): boolean {
    const at = this.locate(id);
    if (!at) return false;
    if (at === "global") {
      const r = setReviewed(this.readGlobal(), id, reviewed);
      if (r.changed) this.writeGlobal(r.items);
      return r.changed;
    }
    const r = setReviewed(this.readProject(), id, reviewed);
    if (r.changed) this.writeProject(r.items);
    return r.changed;
  }

  edit(id: string, patch: { title?: string; body?: string; type?: string }): SaveResult {
    const at = this.locate(id);
    if (!at) return { ok: false, item: null, created: false, error: "未找到该记忆" };
    if (at === "global") {
      const r = updateItem(this.readGlobal(), id, patch);
      if (!r.item) return { ok: false, item: null, created: false, error: r.error };
      this.writeGlobal(r.items);
      return { ok: true, item: r.item, created: false };
    }
    const r = updateItem(this.readProject(), id, patch);
    if (!r.item) return { ok: false, item: null, created: false, error: r.error };
    this.writeProject(r.items);
    return { ok: true, item: r.item, created: false };
  }
}

let service: MemoryService | undefined;

export function configureMemoryService(deps: MemoryServiceDeps): MemoryService {
  service = new MemoryService(deps);
  return service;
}

export function getMemoryService(): MemoryService {
  if (!service) throw new Error("MemoryService 未初始化（应在主进程 whenReady 内 configureMemoryService）");
  return service;
}
