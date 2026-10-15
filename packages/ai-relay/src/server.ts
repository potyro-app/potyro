// The free AI allowance's relay as a process: `node --experimental-strip-types src/server.ts` on Node 22
// (docs/16 "AI for apps").
//
//   OPENROUTER_API_KEY     required — a key for Potyro's own OpenRouter account, with a credit limit set there
//   AI_MODEL               default google/gemini-2.5-flash-lite (AI_MODEL in request.ts)
//   AI_MONTHLY_CAP_USD     default 10 — the whole service's spend a calendar month, checked before each request
//   AI_PER_DEVICE_DAY      default 20
//   AI_PER_DEVICE_MONTH    default 100
//   AI_PER_ADDRESS_DAY     default 60
//   AI_LEDGER              default ./ai-ledger.json — the month's spend and counts, so a restart keeps them
//   PORT                   default 4203
//   HOST                   default 127.0.0.1 — reachable only through the proxy in front of it
//
// Behind Apache on the site's origin (`/ai/` → here), like the platform-request relay: the site's gate
// covers it and the browser needs no CORS. The sender's address is the first `X-Forwarded-For` entry.

import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createAiRelay, persistentLedger, type Limits, type RelayRequest, type RelayResponse } from "./relay.ts";
import { AI_LIMITS, AI_MODEL, OPENROUTER_URL, readOpenRouterReply, type UpstreamReply } from "./request.ts";

/** A prefix the proxy may leave on the path (`/ai/complete` → `/complete`). */
const PREFIX = /^\/ai(?=\/)/;
/** OpenRouter is given this long, body included; the shell gives up on the relay a little later. */
const UPSTREAM_MS = 45_000;

export function startServer(opts: { handle: (req: RelayRequest) => Promise<RelayResponse>; port: number; host: string }): Promise<Server> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > AI_LIMITS.bytes) over = true;
      else chunks.push(chunk);
    });
    req.on("end", () => {
      const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]!.trim();
      const reply = (r: RelayResponse): void => {
        res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(r.body));
      };
      if (over) return reply({ status: 413, body: { ok: false, error: "too big" } });
      opts
        .handle({
          method: req.method ?? "GET",
          path: (req.url ?? "/").split("?")[0]!.replace(PREFIX, ""),
          body: Buffer.concat(chunks).toString("utf8"),
          ip: forwarded || req.socket.remoteAddress || "unknown",
        })
        .then(reply, () => reply({ status: 500, body: { ok: false } }));
    });
  });
  return new Promise((resolve) => server.listen(opts.port, opts.host, () => resolve(server)));
}

export function openRouter(key: string, fetchImpl: typeof fetch = fetch): (body: Record<string, unknown>) => Promise<UpstreamReply> {
  return async (body) => {
    const res = await fetchImpl(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://github.com/fuzue/potyro", "X-Title": "Potyro (free AI for apps)" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(UPSTREAM_MS),
    });
    return readOpenRouterReply(res.status, await res.text());
  };
}

const num = (name: string): number | undefined => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
};

async function main(): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error("OPENROUTER_API_KEY is not set: the relay pays for the free allowance with it, and will not start without it.");
    process.exit(1);
  }
  const file = process.env.AI_LEDGER ?? "./ai-ledger.json";
  // A ledger that cannot be read stops the relay rather than starting the month again at zero.
  const initial = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as never) : null;
  const ledger = persistentLedger(initial, (s) => {
    writeFileSync(`${file}.tmp`, JSON.stringify(s));
    renameSync(`${file}.tmp`, file);
  });
  const limits: Partial<Limits> = Object.fromEntries(
    (
      [
        ["monthlyUsd", num("AI_MONTHLY_CAP_USD")],
        ["perDeviceDay", num("AI_PER_DEVICE_DAY")],
        ["perDeviceMonth", num("AI_PER_DEVICE_MONTH")],
        ["perAddressDay", num("AI_PER_ADDRESS_DAY")],
      ] as const
    ).filter(([, v]) => v !== undefined),
  );
  const model = process.env.AI_MODEL || AI_MODEL;
  const relay = createAiRelay({ upstream: openRouter(key), now: Date.now, ledger, limits, model, onError: (e) => console.error("[ai-relay]", e instanceof Error ? e.message : e) });
  const port = Number(process.env.PORT ?? 4203);
  const host = process.env.HOST ?? "127.0.0.1";
  await startServer({ handle: relay.handle, port, host });
  console.log(`[ai-relay] ${model}, cap $${limits.monthlyUsd ?? 10} a month, listening on ${host}:${port}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
