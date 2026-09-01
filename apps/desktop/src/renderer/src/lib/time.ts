/** 会话列表的相对时间（对齐参考样式：15小时 / 1天 / 刚刚）。 */
export function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const min = Math.floor((Date.now() - t) / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}小时`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天`;
  const d = new Date(t);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 空态对话框上方的时间问候。 */
export function greeting(date: Date = new Date()): string {
  const h = date.getHours();
  if (h < 6) return "夜深了，";
  if (h < 12) return "上午好，";
  if (h < 14) return "中午好，";
  if (h < 18) return "下午好，";
  return "晚上好，";
}
