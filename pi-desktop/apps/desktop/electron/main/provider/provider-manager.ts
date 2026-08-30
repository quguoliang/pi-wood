import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { ipcMain } from "electron";
import { z } from "zod";
import {
  getProviderKey,
  setProviderKey,
  removeProviderKey,
  listStoredProviders,
  loadAllKeysAsEnv,
  injectProviderEnv,
} from "./keychain";

/**
 * Provider 管理（T3.2，方案 §5.6/§7）。
 * ⚠️ §8 实测红线：自定义 models.json 同名 provider 会覆盖内置目录并丢失 compat——
 * 因此自定义端点强制使用 "custom-" 前缀 id，绝不与内置目录冲突；写入前合并旧文件。
 */

const BUILTIN_PROVIDERS = [
  { id: "deepseek", name: "DeepSeek" },
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Anthropic" },
  { id: "google", name: "Google Gemini" },
  { id: "openrouter", name: "OpenRouter" },
  { id: "groq", name: "Groq" },
  { id: "xai", name: "xAI" },
  { id: "moonshot", name: "Moonshot Kimi" },
] as const;

const SetKeyArgSchema = z.object({
  provider: z.string().min(1),
  key: z.string().min(1),
});
const CustomProviderArgSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^custom-[a-z0-9-]+$/, "自定义 provider id 必须以 custom- 开头"),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  modelId: z.string().min(1),
});

let cachedAgentDir: string | undefined;

/** §8 规则：主进程禁止静态 import Pi（ESM-only），一律动态 import */
async function getAgentDirLazy(): Promise<string> {
  cachedAgentDir ??= (await import("@earendil-works/pi-coding-agent")).getAgentDir();
  return cachedAgentDir;
}

async function modelsJsonPath(): Promise<string> {
  return join(await getAgentDirLazy(), "models.json");
}

interface ModelsJson {
  providers: Record<string, unknown>;
}

function readModelsJson(): ModelsJson {
  const p = join(cachedAgentDir ?? "", "models.json");
  if (existsSync(p)) {
    try {
      return JSON.parse(readFileSync(p, "utf-8")) as ModelsJson;
    } catch {
      /* fallthrough */
    }
  }
  return { providers: {} };
}

async function writeCustomProvider(id: string, cfg: unknown): Promise<void> {
  const reg = readModelsJson();
  reg.providers = { ...(reg.providers ?? {}), [id]: cfg };
  const p = await modelsJsonPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(reg, null, 2));
}

export function initProviderIpc(): void {
  ipcMain.handle("provider:list", async () => {
    await getAgentDirLazy();
    return {
      builtin: BUILTIN_PROVIDERS.map((p) => ({
        ...p,
        hasKey: listStoredProviders().includes(p.id) || Boolean(process.env[`${p.id.toUpperCase()}_API_KEY`]),
      })),
      custom: Object.keys(readModelsJson().providers),
    };
  });

  ipcMain.handle("provider:setKey", (_e, raw: unknown) => {
    const { provider, key } = SetKeyArgSchema.parse(raw);
    setProviderKey(provider, key);
    injectProviderEnv({ [provider]: key });
    return true;
  });

  ipcMain.handle("provider:removeKey", (_e, raw: unknown) => {
    const { provider } = z.object({ provider: z.string() }).parse(raw);
    removeProviderKey(provider);
    return true;
  });

  ipcMain.handle("provider:addCustom", async (_e, raw: unknown) => {
    const cfg = CustomProviderArgSchema.parse(raw);
    // OpenAI 兼容端点模板
    await writeCustomProvider(cfg.id, {
      name: cfg.name,
      baseUrl: cfg.baseUrl,
      api: "openai-completions",
      apiKey: cfg.apiKey,
      models: [
        {
          id: cfg.modelId,
          name: cfg.modelId,
          reasoning: false,
          input: ["text"],
          contextWindow: 131072,
          maxTokens: 8192,
        },
      ],
    });
    return true;
  });

  /** 引擎启动前调用：把钥匙串中的密钥注入环境变量 */
  injectProviderEnv(loadAllKeysAsEnv());
}

/** 供 engine-manager 启动前再次注入（keychain 内容可能运行期变化） */
export function reinjectProviderEnv(): void {
  injectProviderEnv(loadAllKeysAsEnv());
}
