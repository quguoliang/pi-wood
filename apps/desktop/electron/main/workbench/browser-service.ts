import { ipcMain } from "electron";
import { z } from "zod";

/**
 * 浏览器服务（T2.4，headless 降级版，R-4 决策）：
 * - playwright-core + 系统 Edge/Chrome（headless），不下载浏览器
 * - 面板用：navigate/screenshot/read/click/fill
 * - 同一套能力以 agent 工具暴露（agent-tools/browser-tools.ts）
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

let page: AnyPage | undefined;
let launching: Promise<AnyPage> | undefined;
let currentUrl = "";

async function ensurePage(): Promise<AnyPage> {
  if (page) return page;
  launching ??= (async () => {
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
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await context.newPage();
    p.setDefaultTimeout(8000);
    page = p;
    return p;
  })();
  page = await launching;
  return page;
}

async function withPage<T>(fn: (p: AnyPage) => Promise<T>): Promise<T> {
  const p = await ensurePage();
  return fn(p);
}

export function initBrowserIpc(): void {
  ipcMain.handle("browser:navigate", (_e, raw: unknown) =>
    withPage(async (p) => {
      const { url } = z.object({ url: z.string().url() }).parse(raw);
      await p.goto(url, { waitUntil: "domcontentloaded" });
      currentUrl = url;
      const title = await p.title();
      return { title };
    }),
  );

  ipcMain.handle("browser:screenshot", () =>
    withPage(async (p) => ({
      screenshot: (await p.screenshot({ type: "png" })).toString("base64"),
      url: currentUrl,
    })),
  );

  ipcMain.handle("browser:read", () =>
    withPage(async (p) => {
      const text = await p.content();
      const plain = text
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return { text: plain.slice(0, 4000), url: currentUrl };
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
    const p = page;
    page = undefined;
    launching = undefined;
    await p?.close();
    return true;
  });
}

export async function browserNavigate(url: string): Promise<void> {
  await withPage(async (p) => {
    await p.goto(url, { waitUntil: "domcontentloaded" });
    currentUrl = url;
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
