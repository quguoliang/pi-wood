import { Type } from "typebox";
import type { CustomToolDef } from "./browser-tools";
import { getMemoryService } from "../memory/memory-service.ts";

/**
 * T7.10 Agent Memory 工具（in-process customTool，主进程直接读写记忆文件）。
 * 跨会话留存值得记住的信息；agent 保存的默认「待确认」(reviewed:false)，用户在设置页确认后转正。
 * scope：global 跨项目、project 仅当前项目（由活动项目目录推导，agent 不能指定项目 id）。
 */
export function memoryCustomTools(): CustomToolDef[] {
  // 注意：工具名必须匹配 ^[a-zA-Z0-9_-]+$——OpenAI 兼容端点（DeepSeek 等）会拒绝含「.」的名字
  // （400 Invalid tools[i].function.name），导致整轮请求失败、助手回复为空。故用下划线而非 memory.save 式点号。
  return [
    {
      name: "memory_save",
      label: "保存记忆",
      description:
        "跨会话记住一件事（偏好/事实/参考）。下次会话仍可见。scope=global 跨所有项目、project 仅当前项目（默认 global）。" +
        "保存的内容默认待用户确认；确认后才会视为可靠长期记忆。已有同名同 scope 的条目会更新。",
      parameters: Type.Object({
        scope: Type.Optional(Type.Union([Type.Literal("global"), Type.Literal("project")], { description: "global|project，默认 global" })),
        type: Type.Optional(Type.Union([Type.Literal("fact"), Type.Literal("preference"), Type.Literal("reference")], { description: "默认 fact" })),
        title: Type.String({ description: "简短标题" }),
        body: Type.String({ description: "要记住的内容" }),
      }),
      async execute(_id, params) {
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
    },
    {
      name: "memory_list",
      label: "列出记忆",
      description: "列出已保存的记忆（全局 + 当前项目），含 id 与是否已确认。未确认条目谨慎参考。",
      parameters: Type.Object({}),
      async execute() {
        const text = getMemoryService().renderForAgent();
        return { content: [{ type: "text", text }], details: {} };
      },
    },
    {
      name: "memory_read",
      label: "读取记忆",
      description: "按 id 读取一条记忆的完整内容。",
      parameters: Type.Object({ id: Type.String({ description: "memory_list 返回的 id" }) }),
      async execute(_id, params) {
        const m = getMemoryService().read(String(params.id ?? ""));
        if (!m) return { content: [{ type: "text", text: "未找到该记忆" }], details: {} };
        return { content: [{ type: "text", text: `[${m.scope}/${m.type}] ${m.title}（${m.reviewed ? "已确认" : "待确认"}）\n${m.body}` }], details: {} };
      },
    },
    {
      name: "memory_delete",
      label: "删除记忆",
      description: "按 id 删除一条记忆。",
      parameters: Type.Object({ id: Type.String({ description: "要删除的记忆 id" }) }),
      async execute(_id, params) {
        const removed = getMemoryService().remove(String(params.id ?? ""));
        return { content: [{ type: "text", text: removed ? "已删除该记忆" : "未找到该记忆" }], details: { removed } };
      },
    },
  ];
}
