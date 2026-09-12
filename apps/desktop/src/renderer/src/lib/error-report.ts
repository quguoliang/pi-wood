/**
 * 错误报告归一化：把「任意被抛出的东西」变成可展示、可复制的结构。
 *
 * 为什么单独成模块而不是写在 ErrorBoundary 里：fallback 要**给用户看**错误、
 * 要能「复制错误信息」，其中「preload 契约缺失」的识别与处置建议是决定用户
 * 下一步动作（重试 vs 重启应用）的判据——这个口径必须有单测钉住，不能散在 JSX 里。
 *
 * 与之配套的约束：本模块**不得依赖 DOM／React**，以便 `node --test` 直接覆盖
 * （JSX 部分的类型检查交给 desktop 的 tsconfig.web.json）。
 */

export interface ErrorReport {
  /** 归一化后的错误名（TypeError／Error／自定义构造名） */
  name: string;
  /** 单行消息 */
  message: string;
  /** 堆栈（若有） */
  stack?: string;
}

/** `requirePi` 抛出的消息前缀（见 lib/preload-api.ts）——「preload 契约缺失」的唯一判据 */
export const PRELOAD_MISSING_PREFIX = "preload 未提供";

/** preload 缺失的处置：唯一有效的动作是重启应用（刷新页面无效——preload 只在窗口创建时加载） */
export const PRELOAD_HINT =
  "preload 只在窗口创建时加载一次，改动后热更新覆盖不到它。请完全退出应用（不是刷新页面）后重新打开。";

/** 其余错误的处置：先重试，再取证据 */
export const GENERIC_HINT = "可先点「重试」重新挂载这段界面；若反复出现，请把错误信息复制给开发者。";

/** 兜底序列化：任意值 → 字符串，**绝不抛**（循环引用 / BigInt / Symbol / 无原型对象都要能过） */
export function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const json = JSON.stringify(value);
    if (typeof json === "string") return json;
  } catch {
    // 循环引用、BigInt 等：落到 String()
  }
  try {
    return String(value);
  } catch {
    // Object.create(null) 之类没有 toString 的值
    return "[无法序列化的值]";
  }
}

/** 归一化任意抛出物。注意 `throw undefined` 也要得到可读结果（不能当成「无错误」） */
export function describeError(err: unknown): ErrorReport {
  if (err instanceof Error) {
    const name = err.name || "Error";
    const message = err.message || name;
    return err.stack ? { name, message, stack: err.stack } : { name, message };
  }
  if (typeof err === "string") return { name: "Error", message: err };
  return { name: "UnknownError", message: safeStringify(err) };
}

/**
 * 从 V8 的 TypeError 消息里取出「X is not a function」的函数名。
 *
 * 为什么需要它：真机白屏的值**不是** requirePi 抛的错，而是**原生 TypeError**
 * `window.pi.fsImage is not a function`（旧 preload 里没有这个函数）。若只认「preload 未提供」
 * 前缀，这类错误会被判成普通错误 ⇒ 提示用户「点重试」⇒ 重挂子树后照抛（preload 并不会变）
 * ⇒ 用户在「重试→崩溃」里打转。所以必须按**函数名反查**，而不是猜消息前缀。
 */
export function missingFunctionName(err: unknown): string | undefined {
  const matched = /([A-Za-z0-9_$]+) is not a function/.exec(describeError(err).message);
  return matched ? matched[1] : undefined;
}

/** 取用于判定的 preload 对象：显式传入优先，否则回落到 window.pi */
function resolvePi(pi?: unknown): unknown {
  if (pi !== undefined) return pi;
  const host = (globalThis as { window?: { pi?: unknown } }).window;
  return host ? host.pi : undefined;
}

/**
 * 是否属于「preload 契约缺失」——决定提示用户「重试」还是「重启应用」，故判据要稳：
 *
 * 1. `requirePi` 显式抛出的（消息带前缀）⇒ 是。
 * 2. **原生 TypeError 且该函数确实不在 preload 上** ⇒ 是（不依赖消息里的变量前缀，
 *    打包压缩后前缀会变成 `e.fsImage`，只有函数名稳定）。
 * 3. `window.pi` 整体没注入时，任何「读 undefined 的属性」都只可能是它 ⇒ 是。
 * 4. 其余 ⇒ 否（例如业务代码自己抛的 `渲染失败`——不能也劝人去重启）。
 */
export function isPreloadContractError(err: unknown, pi?: unknown): boolean {
  const message = describeError(err).message;
  if (message.includes(PRELOAD_MISSING_PREFIX)) return true;

  const target = resolvePi(pi);
  const usable = typeof target === "object" && target !== null;
  if (!usable) {
    return /is not a function/.test(message) || /Cannot read properties of (undefined|null)/.test(message);
  }

  const name = missingFunctionName(err);
  return name !== undefined && typeof (target as Record<string, unknown>)[name] !== "function";
}

/** 给用户的一行处置建议 */
export function recoveryHint(err: unknown, pi?: unknown): string {
  return isPreloadContractError(err, pi) ? PRELOAD_HINT : GENERIC_HINT;
}

/**
 * 供「复制」的完整报告。
 * `at` 由调用方传入（不在函数内取当前时间），使输出可断言。
 */
export function formatErrorReport(err: unknown, scope: string, at: Date, pi?: unknown): string {
  const report = describeError(err);
  const lines = [
    `[pi-wood] ${scope} 崩溃`,
    `时间：${at.toISOString()}`,
    `类型：${report.name}`,
    `消息：${report.message}`,
    `处置：${recoveryHint(err, pi)}`,
  ];
  if (report.stack) lines.push("", "堆栈：", report.stack);
  return lines.join("\n");
}
