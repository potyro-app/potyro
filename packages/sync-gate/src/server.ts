// The gate as a process: `node --experimental-strip-types src/server.ts` on Node 22 (docs/16 "The
// gate in front of the relay"). No dependencies, so nothing to install.
//
//   PORT                          default 4206
//   HOST                          default 127.0.0.1 — reachable only through the proxy in front of it
//   SYNC_UPSTREAM                 default 127.0.0.1:4201 — the relay (`jazz-run sync`), host:port
//   TRUST_PROXY                   default caddy — whose X-Forwarded-For to believe (address.ts); `none` for none
//   SYNC_ORIGINS                  comma-separated browser origins allowed to connect; default any ("*")
//   SYNC_CONNECTIONS_PER_ADDRESS  default 64 at once (an IPv6 address counts as its /64)
//   SYNC_CONNECTS_PER_SECOND      default 10 new connections a second per address (burst SYNC_CONNECT_BURST, default 300)
//   SYNC_BYTES_PER_SECOND         default 1048576 towards the relay per address (burst SYNC_BYTE_BURST, default 8388608); slowed past it
//   SYNC_FRAMES_PER_SECOND        default 1000 per address (burst SYNC_FRAME_BURST, default 20000); slowed past it
//   SYNC_BYTES_PER_ADDRESS_DAY    default 2147483648 towards the relay per address a day (UTC)
//   SYNC_BYTES_DAY                default 10737418240 towards the relay from everyone a day (UTC): size it to the disk
//   SYNC_MAX_MESSAGE_BYTES        default 8388608
//   SYNC_MAX_CONNECTIONS          default 5000 for the whole gate
//   SYNC_MAX_ADDRESSES            default 100000 addresses counted at once
//   SYNC_DISK_PATH                a path on the relay's disk (its data folder, mounted read-only). Unset: free disk is not checked
//   SYNC_MIN_FREE_BYTES           default 2147483648 — with SYNC_DISK_PATH: no sync while the disk has less free
//
// Behind Caddy on the site's origin (`/sync` → here → the relay). It logs its start and stop, one
// line of totals an hour when anything happened, and the relay being closed to writes — never an
// address, a single refusal, or anything a connection carried.
import { statfs } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { readTrustProxy } from "./address.ts";
import { startSyncGate } from "./gate.ts";
import type { GateLimits } from "./limits.ts";

const ENV_LIMITS: ReadonlyArray<readonly [string, keyof GateLimits]> = [
  ["SYNC_CONNECTIONS_PER_ADDRESS", "connectionsPerAddress"],
  ["SYNC_CONNECTS_PER_SECOND", "connectsPerSecond"],
  ["SYNC_CONNECT_BURST", "connectBurst"],
  ["SYNC_BYTES_PER_SECOND", "bytesPerSecond"],
  ["SYNC_BYTE_BURST", "byteBurst"],
  ["SYNC_FRAMES_PER_SECOND", "framesPerSecond"],
  ["SYNC_FRAME_BURST", "frameBurst"],
  ["SYNC_BYTES_PER_ADDRESS_DAY", "bytesPerAddressDay"],
  ["SYNC_BYTES_DAY", "bytesPerDay"],
  ["SYNC_MAX_MESSAGE_BYTES", "messageBytes"],
  ["SYNC_MAX_CONNECTIONS", "connections"],
  ["SYNC_MAX_ADDRESSES", "addresses"],
  ["SYNC_MIN_FREE_BYTES", "minFreeBytes"],
];

/** The limits an environment sets; a value that is not a positive number stops the gate starting. */
export function limitsFromEnv(env: Record<string, string | undefined>): Partial<GateLimits> {
  const out: Partial<GateLimits> = {};
  for (const [name, key] of ENV_LIMITS) {
    const raw = env[name];
    if (raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, got "${raw}"`);
    out[key] = n;
  }
  return out;
}

/** `SYNC_UPSTREAM` as host and port; anything else stops the gate starting. */
export function upstreamFromEnv(raw: string | undefined): { host: string; port: number } {
  const m = /^(.+):(\d{1,5})$/.exec((raw ?? "").trim() || "127.0.0.1:4201");
  const port = m ? Number(m[2]) : 0;
  if (!m || port < 1 || port > 65535) throw new Error(`SYNC_UPSTREAM must be host:port, got "${raw}"`);
  return { host: m[1]!.replace(/^\[|\]$/g, ""), port };
}

export function originsFromEnv(raw: string | undefined): readonly string[] | "*" {
  if (raw === undefined || raw.trim() === "" || raw.trim() === "*") return "*";
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/** The free bytes on the disk `path` is on. */
export const freeBytesOf = (path: string) => async (): Promise<number> => {
  const s = await statfs(path);
  return s.bavail * s.bsize;
};

async function main(): Promise<void> {
  const limits = limitsFromEnv(process.env);
  const upstream = upstreamFromEnv(process.env.SYNC_UPSTREAM);
  const trustProxy = readTrustProxy(process.env.TRUST_PROXY);
  const origins = originsFromEnv(process.env.SYNC_ORIGINS);
  const disk = process.env.SYNC_DISK_PATH || undefined;
  if (disk) await statfs(disk); // a path that is not there stops the gate starting, not the check silently
  const port = Number(process.env.PORT ?? 4206);
  const host = process.env.HOST ?? "127.0.0.1";
  const gate = await startSyncGate({
    port,
    host,
    upstream,
    limits,
    trustProxy,
    origins,
    ...(disk ? { freeBytes: freeBytesOf(disk) } : {}),
    log: (line) => console.log(line),
  });
  const bound = gate.server.address() as AddressInfo;
  console.log(
    `[sync-gate] in front of ${upstream.host}:${upstream.port}, listening on ${host}:${bound.port}, trusting ${trustProxy}, ` +
      `origins ${origins === "*" ? "any" : origins.join(" ")}, free disk ${disk ? `checked at ${disk}` : "not checked (no SYNC_DISK_PATH)"}`,
  );
  const stop = (): void => {
    void gate.close().then(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error("[sync-gate]", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
