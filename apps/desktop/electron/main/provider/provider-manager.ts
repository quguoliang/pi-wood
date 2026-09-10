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
  providerEnvName,
} from "./keychain";

/**
 * Provider 管理（T3.2 → 供应商管理改版）。
 * ⚠️ §8 实测红线：自定义 models.json 同名 provider 会覆盖内置目录并丢失 compat——
 * 因此自定义端点强制使用 "custom-" 前缀 id，绝不与内置目录冲突；写入前合并旧文件。
 *
 * 密钥口径：keys.json（safeStorage 加密）是**唯一**密钥存放处；models.json 里只写
 * `${<ID>_API_KEY}` 环境占位符（Pi SDK resolve-config-value 解析），明文绝不落盘。
 * 供应商增删改后回调 onProvidersChanged → 引擎侧对空闲 child 热重载 models.json。
 */

/**
 * 内置供应商目录（凭据 env 约定 <ID>_API_KEY）。api = 该家 SDK 内置目录使用的请求格式，
 * 给内置供应商「追加模型」时按它写 model.api（端点/鉴权仍走内置，不碰 baseUrl）。
 */
const BUILTIN_PROVIDERS = [
  { id: "deepseek", name: "DeepSeek", api: "openai-completions" },
  { id: "openai", name: "OpenAI", api: "openai-completions" },
  { id: "anthropic", name: "Anthropic", api: "anthropic-messages" },
  { id: "google", name: "Google Gemini", api: "google-generative-ai" },
  { id: "openrouter", name: "OpenRouter", api: "openai-completions" },
  { id: "groq", name: "Groq", api: "openai-completions" },
  { id: "xai", name: "xAI", api: "openai-completions" },
  { id: "moonshot", name: "Moonshot Kimi", api: "openai-completions" },
] as const;

const isBuiltinId = (id: string): boolean => (BUILTIN_PROVIDERS as readonly { id: string }[]).some((p) => p.id === id);

const SetKeyArgSchema = z.object({
  provider: z.string().min(1),
  key: z.string().min(1),
});

/** 模型清单条目。input 收 UI 全集（含 video/pdf），落盘只保留 SDK schema 允许的 text/image */
const CustomModelSchema = z.object({
  id: z.string().min(1).max(160),
  contextWindow: z.number().int().positive().max(100_000_000),
  maxTokens: z.number().int().positive().max(10_000_000),
  input: z.array(z.enum(["text", "image", "video", "pdf"])).default(["text"]),
});

/** 给内置供应商追加/更新模型清单（空数组=清除追加）。⚠️ 只写 models[]，绝不写 baseUrl/api——§8 红线 */
const SetBuiltinModelsSchema = z.object({
  provider: z.string().refine(isBuiltinId, "只能给内置供应商追加模型（自定义供应商走 upsertCustom）"),
  models: z.array(CustomModelSchema).max(50),
});

/** UI 模型条目 → models.json 落盘形（input 收敛 + 必备字段补全）；api 缺席=沿用供应商级 */
function toStoredModel(m: z.infer<typeof CustomModelSchema>, api?: string): Record<string, unknown> {
  const input = m.input.filter((i): i is "text" | "image" => i === "text" || i === "image");
  return {
    id: m.id,
    name: m.id,
    ...(api ? { api } : {}),
    reasoning: false,
    input: input.length > 0 ? input : ["text"],
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
  };
}

const UpsertCustomSchema = z.object({
  /** 缺省=新建（id 由名称生成）；带上=编辑既有自定义供应商 */
  id: z.string().regex(/^custom-[a-z0-9][a-z0-9-]*$/, "自定义 provider id 必须以 custom- 开头").optional(),
  name: z.string().min(1).max(60),
  baseUrl: z.string().url(),
  /** 空/省略 = 保留已存密钥（编辑场景）；新建时必须给 */
  apiKey: z.string().optional(),
  api: z.enum(["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"]),
  models: z.array(CustomModelSchema).min(1, "请至少添加一个模型"),
});

/** 名称 → custom- 前缀 slug；中文名兜底随机后缀（slug 只留 [a-z0-9-]） */
function slugifyProviderId(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `custom-${ascii || `p${suffix}`}`;
}

function uniqueProviderId(desired: string, taken: Set<string>): string {
  let id = desired;
  let n = 2;
  while (taken.has(id) || (BUILTIN_PROVIDERS as readonly { id: string }[]).some((p) => p.id === id)) {
    id = `${desired}-${n++}`;
  }
  return id;
}

let cachedAgentDir: string | undefined;

/**
 * T8.P 保留动态 import（非格式原因）：agentDir 惰性求值 + cachedAgentDir 缓存；
 * Pi 已在 sdk-adapter 静态引入（旧「主进程禁止静态 import Pi」规则仅适用于 CJS 产物），
 * 此处仅命中模块缓存。保留理由：本模块在引擎启动前就要跑（T3.2 密钥→env），结构不动。
 */
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

async function removeCustomProviderEntry(id: string): Promise<boolean> {
  const reg = readModelsJson();
  if (!reg.providers || !(id in reg.providers)) return false;
  delete reg.providers[id];
  const p = await modelsJsonPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(reg, null, 2));
  return true;
}

/** 渲染层消费的自定义供应商完整视图（脱敏：只报 hasKey，不回传任何密钥） */
interface CustomProviderView {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  hasKey: boolean;
  models: Array<{ id: string; contextWindow: number; maxTokens: number; input: string[] }>;
}

/** models.json 条目的 models[] → 渲染层视图 */
function modelsViewOf(raw: unknown): CustomProviderView["models"] {
  const cfg = (raw ?? {}) as { models?: unknown };
  return (Array.isArray(cfg.models) ? cfg.models : []).map((m) => {
    const mm = (m ?? {}) as Record<string, unknown>;
    return {
      id: String(mm.id ?? ""),
      contextWindow: typeof mm.contextWindow === "number" ? mm.contextWindow : 0,
      maxTokens: typeof mm.maxTokens === "number" ? mm.maxTokens : 0,
      input: Array.isArray(mm.input) ? (mm.input as unknown[]).map(String) : ["text"],
    };
  });
}

function customProviderViews(): CustomProviderView[] {
  const reg = readModelsJson();
  const out: CustomProviderView[] = [];
  for (const [id, raw] of Object.entries(reg.providers ?? {})) {
    // 与内置同名的条目=「给内置供应商追加的模型」（在内置表单里管理），不在自定义组展示
    if (isBuiltinId(id)) continue;
    const cfg = (raw ?? {}) as { name?: unknown; baseUrl?: unknown; api?: unknown };
    out.push({
      id,
      name: typeof cfg.name === "string" && cfg.name.trim() ? cfg.name : id,
      baseUrl: typeof cfg.baseUrl === "string" ? cfg.baseUrl : "",
      api: typeof cfg.api === "string" ? cfg.api : "openai-completions",
      hasKey: listStoredProviders().includes(id) || Boolean(process.env[providerEnvName(id)]),
      models: modelsViewOf(raw),
    });
  }
  return out;
}

export function initProviderIpc(onProvidersChanged?: () => void): void {
  ipcMain.handle("provider:list", async () => {
    await getAgentDirLazy();
    const reg = readModelsJson();
    return {
      builtin: BUILTIN_PROVIDERS.map((p) => ({
        ...p,
        hasKey: listStoredProviders().includes(p.id) || Boolean(process.env[providerEnvName(p.id)]),
        // 用户追加到该内置供应商的模型（models.json 同名条目只含 models[]，端点仍走内置）
        extraModels: modelsViewOf(reg.providers?.[p.id]),
      })),
      custom: customProviderViews(),
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
    delete process.env[providerEnvName(provider)];
    return true;
  });

  /** 新建或编辑自定义供应商（整表单覆盖式保存） */
  ipcMain.handle("provider:upsertCustom", async (_e, raw: unknown) => {
    const cfg = UpsertCustomSchema.parse(raw);
    await getAgentDirLazy();
    const existing = new Set(Object.keys(readModelsJson().providers ?? {}));
    const id = cfg.id ?? uniqueProviderId(slugifyProviderId(cfg.name), existing);

    const trimmedKey = cfg.apiKey?.trim();
    if (trimmedKey) {
      setProviderKey(id, trimmedKey);
      injectProviderEnv({ [id]: trimmedKey });
    } else if (!getProviderKey(id) && !process.env[providerEnvName(id)]) {
      // 编辑保留旧钥仅在「原供应商已有凭据」时成立；新建/无凭据编辑必须显式给 Key
      throw new Error("请为该供应商配置 API Key（密钥加密存于 ~/.pi-wood/keys.json）");
    }

    // 落 models.json：apiKey 只写 ${ENV} 占位；input 收敛到 SDK 支持的 text/image
    await writeCustomProvider(id, {
      name: cfg.name,
      baseUrl: cfg.baseUrl,
      api: cfg.api,
      apiKey: `\${${providerEnvName(id)}}`,
      models: cfg.models.map((m) => toStoredModel(m)),
    });
    onProvidersChanged?.();
    return { id };
  });

  /**
   * 给内置供应商追加/更新模型清单（新模型发布但 SDK 目录还没跟上时用）。
   * ⚠️ §8 红线：同名条目只写 models[]——绝不写 baseUrl/api，内置端点与 compat 原样保留；
   * 按 id upsert 进内置目录（撞内置同名 id = 覆盖该条目的展示参数，删掉追加即回落内置）。
   */
  ipcMain.handle("provider:setBuiltinModels", async (_e, raw: unknown) => {
    const { provider, models } = SetBuiltinModelsSchema.parse(raw);
    await getAgentDirLazy();
    const builtin = BUILTIN_PROVIDERS.find((p) => p.id === provider);
    if (!builtin) throw new Error(`未知内置供应商：${provider}`);
    const reg = readModelsJson();
    const entry = { ...((reg.providers?.[provider] ?? {}) as Record<string, unknown>) };
    if (models.length === 0) delete entry.models;
    else entry.models = models.map((m) => toStoredModel(m, builtin.api));
    if (Object.keys(entry).length === 0) delete reg.providers[provider];
    else reg.providers = { ...(reg.providers ?? {}), [provider]: entry };
    const p = await modelsJsonPath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(reg, null, 2));
    onProvidersChanged?.();
    return true;
  });

  /** 删除自定义供应商：models.json 摘条目 + 密钥作废（磁盘 keys.json 同步删） */
  ipcMain.handle("provider:removeCustom", async (_e, raw: unknown) => {
    const { id } = z.object({ id: z.string().regex(/^custom-/) }).parse(raw);
    const removed = await removeCustomProviderEntry(id);
    if (removed) {
      removeProviderKey(id);
      delete process.env[providerEnvName(id)];
      onProvidersChanged?.();
    }
    return removed;
  });

  /** 引擎启动前调用：把钥匙串中的密钥注入环境变量 */
  injectProviderEnv(loadAllKeysAsEnv());
}

/** 供 engine-manager 启动前再次注入（keychain 内容可能运行期变化） */
export function reinjectProviderEnv(): void {
  injectProviderEnv(loadAllKeysAsEnv());
}
