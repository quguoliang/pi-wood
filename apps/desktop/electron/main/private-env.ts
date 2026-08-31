import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Loads only the project-local secret file. Values never leave process.env. */
export function loadPrivateEnv(appPath: string): void {
  const path = join(appPath, ".env");
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2];
  }
}
