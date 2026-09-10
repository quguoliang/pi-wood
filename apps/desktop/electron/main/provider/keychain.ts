import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { safeStorage } from "electron";
import { DEFAULT_APP_DATA_DIR } from "../project/project-manager";

/**
 * 密钥钥匙串（T3.2，方案 §9）：Electron safeStorage（Windows=DPAPI）
 * 密文落盘 ~/.pi-wood/keys.json；不可用时回退明文并标记 plaintext=true（UI 警示）。
 */
export interface KeyStoreFile {
  plaintext?: boolean;
  keys: Record<string, string>;
}

function keysPath(): string {
  return join(DEFAULT_APP_DATA_DIR, "keys.json");
}

function readStore(): KeyStoreFile {
  if (!existsSync(keysPath())) return { keys: {} };
  try {
    return JSON.parse(readFileSync(keysPath(), "utf-8")) as KeyStoreFile;
  } catch {
    return { keys: {} };
  }
}

function writeStore(store: KeyStoreFile): void {
  mkdirSync(dirname(keysPath()), { recursive: true });
  writeFileSync(keysPath(), JSON.stringify(store, null, 2));
}

export function setProviderKey(provider: string, key: string): void {
  const store = readStore();
  if (safeStorage.isEncryptionAvailable()) {
    store.keys[provider] = safeStorage.encryptString(key).toString("base64");
    store.plaintext = false;
  } else {
    store.keys[provider] = Buffer.from(key, "utf-8").toString("base64");
    store.plaintext = true;
  }
  writeStore(store);
}

export function getProviderKey(provider: string): string | undefined {
  const store = readStore();
  const enc = store.keys[provider];
  if (!enc) return undefined;
  const buf = Buffer.from(enc, "base64");
  try {
    if (!store.plaintext && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf);
    }
  } catch {
    /* fallthrough */
  }
  return buf.toString("utf-8");
}

export function removeProviderKey(provider: string): void {
  const store = readStore();
  delete store.keys[provider];
  writeStore(store);
  void rmSync;
}

export function listStoredProviders(): string[] {
  return Object.keys(readStore().keys);
}

/**
 * 内置 Provider → 凭据环境变量映射（对齐 pi env-api-keys 约定 <ID>_API_KEY）。
 * 启动引擎前注入 process.env，供 ModelRuntime 凭据解析。
 * ⚠️ 统一走 providerEnvName：Pi SDK 的 ${VAR} 占位符只认 [A-Za-z_][A-Za-z0-9_]*，
 * 自定义供应商 id 带 '-'（custom-abi）必须转成下划线，否则 models.json 占位解析不到。
 */
export function providerEnvName(provider: string): string {
  return `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
}

export function injectProviderEnv(keys: Record<string, string>): void {
  for (const [provider, key] of Object.entries(keys)) {
    const envName = providerEnvName(provider);
    if (key) process.env[envName] = key;
  }
}

export function loadAllKeysAsEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of listStoredProviders()) {
    const k = getProviderKey(p);
    if (k) out[p] = k;
  }
  return out;
}

/**
 * 凭据 env 快照（env 名 → 值）。child 的 process.env 是 fork 时快照，
 * 供应商管理新配/改配的 Key 要靠它经 syncEnv RPC 补发给活体 child。
 */
export function providerEnvSnapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [provider, key] of Object.entries(loadAllKeysAsEnv())) out[providerEnvName(provider)] = key;
  return out;
}
