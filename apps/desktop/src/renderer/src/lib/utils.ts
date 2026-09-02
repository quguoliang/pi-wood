import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** T7.1 大文本粘贴阈值：字符数或行数任一达标即转为文件附件，避免污染输入框。 */
export const LARGE_PASTE_CHAR_THRESHOLD = 2000;
export const LARGE_PASTE_LINE_THRESHOLD = 25;

/** 判断粘贴文本是否属于「大文本」（双阈值 OR）。 */
export function isLargePaste(text: string): boolean {
  if (text.length >= LARGE_PASTE_CHAR_THRESHOLD) return true;
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  return lines >= LARGE_PASTE_LINE_THRESHOLD;
}

/** 统计文本行数（供 toast 文案展示）。 */
export function countLines(text: string): number {
  return text.split(/\r\n|\r|\n/).length;
}
