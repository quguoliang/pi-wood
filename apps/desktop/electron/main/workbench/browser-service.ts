import { ipcMain } from "electron";
import { z } from "zod";

/**
 * 浏览器服务（T2.4，headless 降级版，R-4 决策）：
 * - playwright-core + 系统 Edge/Chrome（headless），不下载浏览器
 * - 面板用：navigate/screenshot/read/click/fill
 * - 同一套能力以 agent 工具暴露（agent-tools/browser-tools.ts）
 *
 * T8.7 步骤 6：**per-对话 page（共享一个 browser 进程）**——此前全局单 page，一个对话导航
 * 会顶掉另一个。归属=当前 active 对话（由 initBrowserIpc 注入 getter；agent 工具执行时该对话
 * 即 active，语义在注释写明）。上限 2 个活跃 page，超出按 LRU **挂起**（close page 只留 URL，
 * 下次访问自动重新打开）。
 */
type AnyPage = {
  goto(url: string, opts?: object): Promise<{ title?: string }>;
  screenshot(opts?: object): Promise<Buffer>;
  content(): Promise<string>;
  click(selector: string, opts?: object): Promise<void>;
  fill(selector: string, text: string): Promise<void>;
  title(): Promise<string>;
  close(): Promise<void>;
  setDefaultTimeout(timeout: number): void;
};

const MAX_ACTIVE_PAGES = 2;

interface PageEntry {
  page?: AnyPage;
  url: string;
  lastUsedAt: number;
}

let browserRef: unknown;
let browserLaunching: Promise<unknown> | undefined;
const pages = new Map<string, PageEntry>();
let getConversationId: () => string | null = () => null;

/** 由 index.ts 注入「当前对话」解析器（engine-manager 的包装，避免本模块反向依赖） */
export function configureBrowserScope(resolver: () => string | null): void {
  getConversationId = resolver;
}

function currentKey(): string {
  return getConversationId() ?? "__global__";
}

function touch(key: string): PageEntry {
  let e = pages.get(key);
  if (!e) {
    e = { url: "", lastUsedAt: 0 };
    pages.set(key, e);
  }
  e.lastUsedAt = Date.now();
  // LRU 挂起：活跃（已打开 page 的）条目超上限时，关掉最久未用的 page（保留 URL 可恢复）
  const active = [...pages.entries()].filter(([, v]) => v.page);
  if (active.length > MAX_ACTIVE_PAGES) {
    active.sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
    for (let i = 0; i < active.length - MAX_ACTIVE_PAGES; i++) {
      const [, victim] = active[i]!;
      void victim.page?.close().catch(() => undefined);
      victim.page = undefined;
    }
  }
  return e;
}

async function ensureBrowser(): Promise<void> {
  if (browserRef) return;
  browserLaunching ??= (async () => {
    const { chromium } = await import("playwright-core");
    let browser: { newContext(opts: object): Promise<{ newPage(): Promise<AnyPage> }> } | undefined;
    const errors: string[] = [];
    for (const channel of ["msedge", "chrome"] as const) {
      try {
        browser = (await chromium.launch({
          headless: true,
          channel,
          args: ["--no-sandbox"],
        })) as never;
        break;
      } catch (err) {
        errors.push(`${channel}: ${String(err).slice(0, 120)}`);
      }
    }
    if (!browser) throw new Error(`未找到系统 Edge/Chrome：${errors.join(" | ")}`);
    browserRef = browser;
    return browser;
  })();
  await browserLaunching;
}

async function ensurePage(): Promise<{ page: AnyPage; url: string }> {
  await ensureBrowser();
  const entry = touch(currentKey());
  if (!entry.page) {
    const browser = browserRef as { newContext(opts: object): Promise<{ newPage(): Promise<AnyPage> }> };
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await context.newPage();
    p.setDefaultTimeout(8000);
    entry.page = p;
    if (entry.url) await p.goto(entry.url, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  }
  return { page: entry.page, url: entry.url };
}

async function withPage<T>(fn: (p: AnyPage, url: string) => Promise<T>): Promise<T> {
  const { page, url } = await ensurePage();
  return fn(page, url);
}

export function initBrowserIpc(): void {
  ipcMain.handle("browser:navigate", (_e, raw: unknown) =>
    withPage(async (p) => {
      const { url } = z.object({ url: z.string().url() }).parse(raw);
      await p.goto(url, { waitUntil: "domcontentloaded" });
      pages.get(currentKey())!.url = url;
      const title = await p.title();
      return { title };
    }),
  );

  ipcMain.handle("browser:screenshot", () =>
    withPage(async (p, url) => ({
      screenshot: (await p.screenshot({ type: "png" })).toString("base64"),
      url,
    })),
  );

  ipcMain.handle("browser:read", () =>
    withPage(async (p, url) => {
      const text = await p.content();
      const plain = text
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return { text: plain.slice(0, 4000), url };
    }),
  );

  ipcMain.handle("browser:click", (_e, raw: unknown) =>
    withPage(async (p) => {
      const { selector } = z.object({ selector: z.string().min(1) }).parse(raw);
      await p.click(selector);
      return true;
    }),
  );

  ipcMain.handle("browser:fill", (_e, raw: unknown) =>
    withPage(async (p) => {
      const { selector, text } = z.object({ selector: z.string(), text: z.string() }).parse(raw);
      await p.fill(selector, text);
      return true;
    }),
  );

  ipcMain.handle("browser:close", async () => {
    const entry = pages.get(currentKey());
    await entry?.page?.close().catch(() => undefined);
    if (entry) entry.page = undefined;
    return true;
  });
}

export async function browserNavigate(url: string): Promise<void> {
  await withPage(async (p) => {
    await p.goto(url, { waitUntil: "domcontentloaded" });
    pages.get(currentKey())!.url = url;
  });
}
export async function browserText(): Promise<string> {
  return withPage(async (p) => {
    const html = await p.content();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  });
}
export async function browserClick(selector: string): Promise<void> {
  await withPage((p) => p.click(selector));
}
export async function browserFill(selector: string, text: string): Promise<void> {
  await withPage((p) => p.fill(selector, text));
}
export async function browserScreenshot(): Promise<string> {
  return withPage(async (p) => (await p.screenshot({ type: "png" })).toString("base64"));
}
