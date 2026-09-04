import { getMemoryService } from "../memory/memory-service.ts";
import { MEMORY_TOOL_SPECS } from "./host-tool-specs";
import type { CustomToolSpec } from "./host-tool-specs";
import type { CustomToolDef } from "./browser-tools";

/**
 * T7.10 Agent Memory 工具（in-process customTool，主进程直接读写记忆文件）。
 * 工具名/描述等声明搬到 host-tool-specs.ts（electron-free，供引擎子进程注册代理工具，T8.1）；
 * 本文件只留 execute：scope 由活动项目目录推导，agent 不能指定项目 id。
 */

/** 与 MEMORY_TOOL_SPECS 的 name 一一对应；这里漏写一个实现就是编译期类型错误（不用运行时兜底掩盖 undefined）。 */
type MemoryToolName = "memory_save" | "memory_list" | "memory_read" | "memory_delete";

const EXECUTE = {
  memory_save: async (_id, params) => {
    const r = getMemoryService().save({
      scope: params.scope,
      type: params.type,
      title: String(params.title ?? ""),
      body: String(params.body ?? ""),
    });
    if (!r.ok || !r.item) return { content: [{ type: "text", text: `保存失败：${r.error ?? "未知错误"}` }], details: { ok: false } };
    return {
      content: [{ type: "text", text: `已保存记忆：${r.item.title}（${r.item.scope}，${r.created ? "已新增" : "已更新"}，待确认）` }],
      details: { ok: true, id: r.item.id, created: r.created },
    };
  },
  memory_list: async () => {
    const text = getMemoryService().renderForAgent();
    return { content: [{ type: "text", text }], details: {} };
  },
  memory_read: async (_id, params) => {
    const m = getMemoryService().read(String(params.id ?? ""));
    if (!m) return { content: [{ type: "text", text: "未找到该记忆" }], details: {} };
    return { content: [{ type: "text", text: `[${m.scope}/${m.type}] ${m.title}（${m.reviewed ? "已确认" : "待确认"}）\n${m.body}` }], details: {} };
  },
  memory_delete: async (_id, params) => {
    const removed = getMemoryService().remove(String(params.id ?? ""));
    return { content: [{ type: "text", text: removed ? "已删除该记忆" : "未找到该记忆" }], details: { removed } };
  },
} satisfies Record<MemoryToolName, CustomToolDef["execute"]>;

export function memoryCustomTools(): CustomToolDef[] {
  // CustomToolSpec.name 是 string（被接口拓宽），故需窄化回 MemoryToolName；两者由上面的 satisfies 保证同集。
  return MEMORY_TOOL_SPECS.map((s: CustomToolSpec) => ({ ...s, execute: EXECUTE[s.name as MemoryToolName] }));
}
