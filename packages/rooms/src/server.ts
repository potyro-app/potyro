// The rooms relay as a process: `node --experimental-strip-types src/server.ts` on Node 22
// (docs/16 "Rooms for multiplayer apps", protocol in docs/26).
//
//   PORT                          default 4205
//   HOST                          default 127.0.0.1 — reachable only through the proxy in front of it
//   ROOMS_ORIGINS                 comma-separated browser origins allowed to connect, or "*";
//                                 default https://apps.vaz.io,https://localhost,capacitor://localhost
//   ROOMS_TRUST_PROXY             default 1 — the address is the LAST X-Forwarded-For entry (Apache's)
//   ROOMS_MAX_MESSAGE_BYTES       default 65536
//   ROOMS_MAX_MEMBERS             default 16 a room
//   ROOMS_PER_ADDRESS             default 8 rooms at once per address
//   ROOMS_CONNECTIONS_PER_ADDRESS default 64
//   ROOMS_MESSAGES_PER_SECOND     default 30 (burst ROOMS_MESSAGE_BURST, default 60)
//   ROOMS_BYTES_PER_SECOND        default 65536 (burst ROOMS_BYTE_BURST, default 262144)
//   ROOMS_IDLE_MS                 default 1800000 (30 min without a message closes the room)
//   ROOMS_PING_MS                 default 30000
//   ROOMS_BUFFERED_BYTES          default 1048576 queued for one member before it is closed
//   ROOMS_MAX_ROOMS               default 2000 for the whole relay
//   ROOMS_MAX_CONNECTIONS         default 5000 for the whole relay
//
// Behind Apache on the site's origin (`/rooms/` → here, with the websocket upgrade), like the sync
// relay. It logs its start and stop, never a payload, a room id or an address.
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import { startRoomsRelay } from "./relay.ts";
import type { RoomLimits } from "./protocol.ts";

export const DEFAULT_ORIGINS = ["https://apps.vaz.io", "https://localhost", "capacitor://localhost"];

const ENV_LIMITS: ReadonlyArray<readonly [string, keyof RoomLimits]> = [
  ["ROOMS_MAX_MESSAGE_BYTES", "messageBytes"],
  ["ROOMS_MAX_MEMBERS", "membersPerRoom"],
  ["ROOMS_PER_ADDRESS", "roomsPerAddress"],
  ["ROOMS_CONNECTIONS_PER_ADDRESS", "connectionsPerAddress"],
  ["ROOMS_MESSAGES_PER_SECOND", "messagesPerSecond"],
  ["ROOMS_MESSAGE_BURST", "messageBurst"],
  ["ROOMS_BYTES_PER_SECOND", "bytesPerSecond"],
  ["ROOMS_BYTE_BURST", "byteBurst"],
  ["ROOMS_IDLE_MS", "idleMs"],
  ["ROOMS_PING_MS", "pingMs"],
  ["ROOMS_BUFFERED_BYTES", "bufferedBytes"],
  ["ROOMS_MAX_ROOMS", "rooms"],
  ["ROOMS_MAX_CONNECTIONS", "connections"],
];

/** The limits an environment sets; a value that is not a positive number stops the relay starting. */
export function limitsFromEnv(env: Record<string, string | undefined>): Partial<RoomLimits> {
  const out: Partial<RoomLimits> = {};
  for (const [name, key] of ENV_LIMITS) {
    const raw = env[name];
    if (raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, got "${raw}"`);
    out[key] = n;
  }
  return out;
}

export function originsFromEnv(raw: string | undefined): readonly string[] | "*" {
  if (raw === undefined || raw.trim() === "") return DEFAULT_ORIGINS;
  if (raw.trim() === "*") return "*";
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const limits = limitsFromEnv(process.env);
  const origins = originsFromEnv(process.env.ROOMS_ORIGINS);
  const port = Number(process.env.PORT ?? 4205);
  const host = process.env.HOST ?? "127.0.0.1";
  const relay = await startRoomsRelay({
    port,
    host,
    limits,
    origins,
    trustProxy: process.env.ROOMS_TRUST_PROXY !== "0",
    log: (line) => console.log(line),
  });
  const bound = relay.server.address() as AddressInfo;
  console.log(`[rooms] origins ${origins === "*" ? "any" : origins.join(" ")}, listening on ${host}:${bound.port}`);
  const stop = (): void => {
    void relay.close().then(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error("[rooms]", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
