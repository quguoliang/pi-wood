/**
 * 用户消息历史文本的清洗（loadSessionMessages 的 user 分支）。
 *
 * 独立成文件的原因：session-service.ts 顶部静态 import @pi-wood/engine（其 index 的
 * 子路径 import 缺扩展名，裸 node --test 下 ERR_MODULE_NOT_FOUND）——清洗是纯字符串逻辑，
 * 抽出来单测就不必拖起整个引擎包（与 conversation-slice 的「纯函数可穷举」同一原则）。
 *
 * 规则：
 * - 剥离主进程注入的 <file> 附件块（所有消息都剥，引擎侧噪声不进气泡）；
 * - 有元数据（meta）时：image part 不再落「[图片]」占位、尾部「--- 引用片段：」块整段移除——
 *   附件与引用都已以芯片呈现在气泡里，正文再带一份就是重复（用户报障）；
 * - 无元数据（CLI 写入/旧会话）保持旧行为，信息不丢。
 */
export function cleanUserHistoryText(content: unknown, meta?: { attachments?: unknown[]; snippets?: unknown[] }): string {
  const imageCount = meta?.attachments?.filter((a) => (a as { kind?: string }).kind === "image").length ?? 0;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    let skipped = 0;
    text = content
      .map((part) => {
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text;
        if (part && typeof part === "object" && (part as { type?: unknown }).type === "image") {
          skipped += 1;
          return skipped <= imageCount ? "" : "[图片]";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  text = text.replace(/\n*<file\b[\s\S]*?<\/file>\n*/g, "").replace(/\n*<file\b[^>]*>\s*<\/file>\n*/g, "");
  if (meta?.snippets?.length) text = text.replace(/\n*---\n引用片段：[\s\S]*$/, "");
  return text.trim();
}
