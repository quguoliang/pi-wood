/**
 * Composer 底栏两个「档位型」控件的语义：**标签 + 展示色**。
 *
 * 刻意放在**无 JSX／无 DOM**的纯模块里（而不是 `ComposerControls.tsx`），原因有二：
 * ① `node --test` 不能直接吃 `.tsx`，放这里才能被门禁覆盖（见同目录 `composer-levels.test.ts`，
 *    已登记进 `apps/desktop/package.json` 的 `test` 脚本——门禁①：不登记=静默漏测）；
 * ② 让「引擎给的级别」与「界面给的标签／颜色」两份清单**在同文件里对照**，
 *    单测可断言二者不漂移（引擎新增一档而此处忘补颜色，会红而不是静默变灰）。
 *
 * ### 两条硬约束（改这里前先读）
 *
 * ① **颜色类必须是完整字面量**。Tailwind v4 的扫描器只认源码里**原样出现过的完整类名**，
 *    任何 `` `${色} hover:${色}` `` 之类的模板拼接都不会被生成进 CSS——症状是「类设上了、
 *    但完全没颜色」，而且类型检查与单测都不会报。故本文件里每个类名都写全。
 *
 * ② **同一组内不得有两个级别撞色**（相邻档位可复用同色相、仅用透明度分档）。
 *    「不同级别显示不同颜色」是需求本身，撞色即失效；该不变量由单测钉死，
 *    而非靠注释约束后来者。
 */

/** 思考级别 → 中文标签（键＝引擎上报的 thinkingLevel 原值） */
export const thinkingLabels: Record<string, string> = {
  off: "关闭", minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "很高", max: "最高",
};

/**
 * 权限档位 → 展示色。按**危险度降序**排：红＝最松最危险，绿＝最严最安全，
 * 使用户扫一眼底栏就能看出「我给了多大自主权」。
 *
 * 注意是 `Record<string, string>` 而非 `Record<ApprovalMode, string>`：
 * 本模块刻意不 import `ApprovalMode`（它在 JSX 文件里导出，引进来就把纯模块拖回 JSX 侧）。
 * 键集合由单测对照 `approvalOptions` 的四个 mode 断言，等价于穷尽性检查。
 */
export const approvalAccent: Record<string, string> = {
  auto: "text-destructive", // 完全访问：自动执行一切，仅安全门兜底
  highRisk: "text-warning", // 高风险时询问（默认档，故保持原有的琥珀色）
  allAsk: "text-primary", // 每次询问
  denyAll: "text-success", // 只读模式：最严、最安全
};

/**
 * 思考强度 → 展示色。灰 → 蓝 → 琥珀 → 红 的「热度递增」ramp：
 * 同色相相邻两档用透明度再分一级（`/60`、`/70`），7 档即可互不撞色。
 *
 * 刻意**不用绿色**：绿色在本项目语义里是「安全／成功」，而思考级别表达的是
 * 算力与成本，用绿会读成「开了更好」，与「按需升降、越高越贵」的实际含义相反。
 */
export const thinkingAccent: Record<string, string> = {
  off: "text-muted-foreground/50",
  minimal: "text-muted-foreground",
  low: "text-primary/60",
  medium: "text-primary",
  high: "text-warning/70",
  xhigh: "text-warning",
  max: "text-destructive",
};

/** 未知档位的回落色：中性灰。不静默无色，也不借用别的档位的颜色（那样会给出错误暗示）。 */
export const thinkingAccentFallback = "text-muted-foreground";

/** 取某个思考级别对应的展示色；级别缺失或引擎给了本模块未收录的新档位时回落中性灰。 */
export function accentForThinking(level: string | undefined | null): string {
  if (!level) return thinkingAccentFallback;
  return thinkingAccent[level] ?? thinkingAccentFallback;
}

/** 颜色类 → 色相名（`text-primary/60` → `primary`），供单测比较「强度单调」用 */
export function hueOf(accentClass: string): string {
  return accentClass.replace(/^text-/, "").replace(/\/\d+$/, "");
}
