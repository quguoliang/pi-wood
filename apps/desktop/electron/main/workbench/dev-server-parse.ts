/** T7.4 Dev Server 自动发现：纯解析/过滤逻辑（无副作用，可单测）。三平台解析器 + loopback/系统端口过滤。 */

/** 一条监听记录（解析中间态）。 */
export interface RawListen {
  host: string;
  port: number;
  pid?: number;
  command?: string;
}

/** 发现结果（跨包契约在 ipc-schema，这里给出解析层视图）。 */
export interface DiscoveredServer {
  port: number;
  pid: number | null;
  command: string | null;
  host: string;
  url: string;
}

/** 常见系统/服务端口（非 dev server），发现时排除。 */
export const SYSTEM_PORTS: ReadonlySet<number> = new Set([
  22, 53, 80, 135, 139, 443, 445, 631, 1025, 1434, 3306, 3389, 5040, 5432, 5900, 6379, 8080, 11211, 27017, 9229,
]);

/** 解析 host:port，正确处理 IPv6 的 `[..]:port` 形式。 */
export function splitHostPort(addr: string): { host: string; port: number } | null {
  const m6 = addr.match(/^\[([^\]]+)\]:(\d+)$/);
  if (m6) return { host: m6[1], port: Number(m6[2]) };
  const idx = addr.lastIndexOf(":");
  if (idx < 0) return null;
  const host = addr.slice(0, idx);
  const port = Number(addr.slice(idx + 1));
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
  return { host, port };
}

/** 是否 loopback / 通配绑定（LAN 专用地址不算）。 */
export function isLoopbackOrWildcard(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "*" || h === "::" || h === "0.0.0.0" || h === "[::]" || h === "localhost" || h === "::1") return true;
  if (h.startsWith("127.")) return true;
  return false;
}

/** netstat -ano -p TCP 输出 → RawListen[]（仅 LISTENING）。 */
export function parseNetstat(raw: string): RawListen[] {
  const out: RawListen[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[0].toUpperCase() !== "TCP") continue;
    if (cols[3].toUpperCase() !== "LISTENING") continue;
    const hp = splitHostPort(cols[1]);
    if (!hp) continue;
    const pid = Number(cols[4]);
    out.push({ host: hp.host, port: hp.port, pid: Number.isFinite(pid) ? pid : undefined });
  }
  return out;
}

/** lsof -iTCP -sTCP:LISTEN -P -n -F pcn 字段输出 → RawListen[]。 */
export function parseLsofFpcn(raw: string): RawListen[] {
  const out: RawListen[] = [];
  let pid: number | undefined;
  let command: string | undefined;
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const tag = line[0];
    const val = line.slice(1);
    if (tag === "p") {
      pid = Number(val);
      command = undefined;
      if (!Number.isFinite(pid)) pid = undefined;
    } else if (tag === "c") {
      command = val || undefined;
    } else if (tag === "n") {
      const hp = splitHostPort(val);
      if (hp) out.push({ host: hp.host, port: hp.port, pid, command });
    }
  }
  return out;
}

/** /proc/net/tcp(6) 的 8/32 位十六进制小端地址解码为可读 host。 */
function decodeProcHex(hex: string): string {
  const bytes = hex.match(/.{2}/g) ?? [];
  if (bytes.length === 4) {
    return [3, 2, 1, 0].map((i) => parseInt(bytes[i], 16)).join(".");
  }
  if (bytes.length === 16) {
    const words: number[] = [];
    for (let g = 0; g < 4; g++) {
      const b = bytes.slice(g * 4, g * 4 + 4);
      words.push((parseInt(b[3], 16) << 24 | parseInt(b[2], 16) << 16 | parseInt(b[1], 16) << 8 | parseInt(b[0], 16)) >>> 0);
    }
    if (words.every((w) => w === 0)) return "::";
    if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 1) return "::1";
    const parts: string[] = [];
    for (const w of words) parts.push((w >>> 16).toString(16), (w & 0xffff).toString(16));
    return parts.join(":");
  }
  return hex;
}

/** /proc/net/tcp(6) 内容 → RawListen[]（仅 state 0A=LISTEN）。 */
export function parseProcNetTcp(raw: string): RawListen[] {
  const out: RawListen[] = [];
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    if (cols[3] !== "0A") continue; // LISTEN
    const [hexAddr, hexPort] = (cols[1] ?? "").split(":");
    if (!hexAddr || !hexPort) continue;
    const port = parseInt(hexPort, 16);
    if (!Number.isFinite(port) || port <= 0) continue;
    out.push({ host: decodeProcHex(hexAddr), port });
  }
  return out;
}

/** 统一过滤：loopback/通配 + 排除系统端口 + 按端口去重 → DiscoveredServer[]。 */
export function filterDevServers(
  list: RawListen[],
  excludePorts: ReadonlySet<number> = SYSTEM_PORTS,
): DiscoveredServer[] {
  const byPort = new Map<number, RawListen>();
  for (const item of list) {
    if (!isLoopbackOrWildcard(item.host)) continue;
    if (excludePorts.has(item.port)) continue;
    const prev = byPort.get(item.port);
    const better = !prev || (prev.command == null && item.command != null) || (prev.pid == null && item.pid != null);
    if (better) byPort.set(item.port, item);
  }
  return [...byPort.values()]
    .sort((a, b) => a.port - b.port)
    .map((r) => ({
      port: r.port,
      pid: r.pid ?? null,
      command: r.command ?? null,
      host: r.host,
      url: `http://localhost:${r.port}`,
    }));
}
