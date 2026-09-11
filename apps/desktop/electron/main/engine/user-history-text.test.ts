import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanUserHistoryText } from "./user-history-text.ts";

/**
 * 历史用户消息文本清洗（cleanUserHistoryText）：
 * 附件/引用有元数据时以芯片呈现，正文里注入的 <file> 块、「[图片]」占位、
 * 「--- 引用片段：」尾巴都必须剥掉——否则切对话/重启后气泡正文与芯片双份（用户报障）。
 * 无元数据（CLI 写入/旧会话）保持旧行为，信息不丢。
 */

const IMG = { type: "image", data: "base64…", mimeType: "image/png" };
const metaWithImage = { attachments: [{ path: "/p/i.png", name: "i.png", size: 1, kind: "image" }] };
const metaWithSnippet = {
  attachments: [{ path: "/p/i.png", name: "i.png", size: 1, kind: "image" }],
  snippets: [{ path: "a.md", name: "a.md", start: 14, end: 14, snippet: "| 维度 |" }],
};

test("无元数据：image part 保持 [图片] 占位（旧行为，图片不隐形）", () => {
  const text = cleanUserHistoryText([{ type: "text", text: "看图" }, IMG]);
  assert.equal(text, "看图\n[图片]");
});

test("有图片元数据：image part 不落占位——芯片已展示，正文不再双份", () => {
  const text = cleanUserHistoryText([{ type: "text", text: "描述一下图片信息" }, IMG], metaWithImage);
  assert.equal(text, "描述一下图片信息");
});

test("有引用元数据：尾部「--- 引用片段：」块整段剥掉，正文只留用户输入", () => {
  const raw = "描述一下图片信息\n\n---\n引用片段：\n\na.md:14-14\n```\n| 维度 | 结论 |\n```";
  const text = cleanUserHistoryText([{ type: "text", text: raw }, IMG], metaWithSnippet);
  assert.equal(text, "描述一下图片信息");
});

test("无元数据：引用块保留原文（旧会话/CLI 不丢信息）", () => {
  const raw = "问题\n\n---\n引用片段：\n\na.md:1-2\n```\nx\n```";
  assert.equal(cleanUserHistoryText(raw), raw);
});

test("<file> 附件块无条件剥离（引擎注入噪声不进气泡）", () => {
  const raw = '看看这个\n\n<file name="app.ts">\nconst x = 1;\n</file>';
  assert.equal(cleanUserHistoryText(raw), "看看这个");
});

test("纯附件消息（正文全被剥空）：返回空串，由调用方按元数据决定是否仍落条目", () => {
  assert.equal(cleanUserHistoryText([IMG], metaWithImage), "");
});

test("字符串 content 与 part 数组同口径清洗", () => {
  const raw = '描述\n\n<file name="x.png"></file>';
  assert.equal(cleanUserHistoryText(raw, metaWithImage), "描述");
});
