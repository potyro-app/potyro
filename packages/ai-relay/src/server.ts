// The free AI allowance's relay as a process: `node --experimental-strip-types src/server.ts` on Node 22
// (docs/16 "AI for apps").
//
//   OPENROUTER_API_KEY       required — a key for Potyro's own OpenRouter account, with a credit limit set there
//   AI_MODEL                 default google/gemini-2.5-flash-lite (AI_MODEL in request.ts) — `/complete` only
//   AI_MONTHLY_CAP_USD       default 10 — the whole service's spend a calendar month, every route, checked before each request
//   AI_DAY_USD               default AI_MONTHLY_CAP_USD / 8 — the same, a calendar day (UTC), so one day cannot eat the month
//   AI_MODEL_PRICES          JSON {"<model>": {"input": 0.14, "output": 0.28}}, $ a million tokens, over the table in prices.ts
//   AI_PER_DEVICE_DAY        default 20 — `/complete`
//   AI_PER_DEVICE_MONTH      default 100 — `/complete`
//   AI_PER_ADDRESS_DAY       default 60 — `/complete`
//   AI_CHAT_MODELS           default deepseek/deepseek-v4-flash-0731 — comma-separated, the only models the chat route sends
//   AI_DEVICE_MONTH_USD      default 0.5 — what one device may spend a month on the chat route
//   AI_ADDRESS_DAY_USD       default 4 × AI_DEVICE_MONTH_USD, at most half of AI_DAY_USD — one address (IPv6: its /64) a day on the chat route; must be below AI_DAY_USD
//   AI_CHAT_RESERVE_USD      default 0.02 — the least a chat request is held for while it is out (more when its estimate is more)
//   AI_CHAT_MAX_TOKENS       default 64000 — the clamp on a chat request's max_tokens (the Studio's high thinking level)
//   AI_CHAT_OFF              "1" turns the chat route off (503), read on every request
//   AI_CHAT_OFF_FILE         a path: while a file is there, the chat route is off — the switch that needs no restart
//   AI_COUNT_PER_ADDRESS_DAY default 20 — POST /count from one address a day
//   AI_CORS_ORIGINS          default https://localhost,capacitor://localhost — the native apps' WebView origins
//   TRUST_PROXY              default caddy — whose X-Forwarded-For to believe (address.ts); `none` for none
//   AI_LEDGER                default ./ai-ledger.json — the month's spend and counts, so a restart keeps them
//   PORT                     default 4204
//   HOST                     default 127.0.0.1 — reachable only through the proxy in front of it
//
// Behind Caddy on potyro.app (`/ai/*` → here, the prefix kept and taken off below). The site's own
// pages need no CORS. The native apps' WebViews are other origins (`https://localhost` on Android,
// `capacitor://localhost` on iOS) and post JSON, so the browser asks first: those origins, and only
// those, are answered, without credentials (no cookie or HTTP auth is ever involved).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { clientAddress, readTrustProxy, type TrustProxy } from "./address.ts";
import { createBudget, DEFAULT_MONTHLY_USD } from "./budget.ts";
import { CHAT_MODELS, createChatProxy, type ChatLimits, type ChatReply, type ChatRequest } from "./chat.ts";
import { createCounts, type CountReply, type CountRequest } from "./counts.ts";
import { createAiRelay, persistentLedger, type Limits, type RelayRequest, type RelayResponse } from "./relay.ts";
import { readModelPrices } from "./prices.ts";
import { AI_LIMITS, AI_MODEL, OPENROUTER_URL, readOpenRouterReply, type UpstreamReply } from "./request.ts";

/** A prefix the proxy may leave on the path (`/ai/complete` → `/complete`). */
const PREFIX = /^\/ai(?=\/)/;
/** OpenRouter is given this long on `/complete`, body included; the shell gives up a little later. */
const UPSTREAM_MS = 45_000;
/**
 * And this long on the chat route, body included: the Studio's own timeout (packages/generator,
 * DEFAULT_TIMEOUT_MS). The proxy in front must allow at least as long (docs/16).
 */
export const CHAT_UPSTREAM_MS = 300_000;

export const CHAT_PATH = "/v1/chat/completions";
export const COUNT_PATH = "/count";
export const DEFAULT_CORS_ORIGINS: readonly string[] = ["https://localhost", "capacitor://localhost"];

export interface ServerOptions {
  /** `/complete` and `/health`. */
  handle: (req: RelayRequest) => Promise<RelayResponse>;
  chat?: (req: ChatRequest) => Promise<ChatReply>;
  counts?: (req: CountRequest) => CountReply;
  port: number;
  host: string;
  /** Default `caddy`. */
  trustProxy?: TrustProxy;
  /** Origins answered with CORS headers. Default: the native apps' WebViews. */
  corsOrigins?: readonly string[];
}

function corsHeaders(req: IncomingMessage, origins: readonly string[]): Record<string, string> {
  const origin = req.headers.origin;
  if (!origin || !origins.includes(origin)) return {};
  return { "access-control-allow-origin": origin, vary: "Origin", "access-control-expose-headers": "x-potyro-left-usd" };
}

/** Writes the stream to the response as it comes; stops reading (and so the upstream) if the client goes. */
async function pipe(stream: ReadableStream<Uint8Array>, res: ServerResponse): Promise<void> {
  const reader = stream.getReader();
  let gone = false;
  const onClose = (): void => {
    if (res.writableFinished) return;
    gone = true;
    reader.cancel().catch(() => {});
  };
  // Gone before the answer began: nothing to send it to.
  if (res.destroyed) return onClose();
  res.on("close", onClose);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || gone) break;
      if (!res.write(value)) {
        await new Promise<void>((resolve) => {
          const go = (): void => (res.off("drain", go), res.off("close", go), resolve());
          res.on("drain", go);
          res.on("close", go);
        });
      }
    }
    if (!gone) res.end();
  } catch {
    // The upstream broke off: cut the response so the client sees it did not finish.
    res.destroy();
  }
}

export function startServer(opts: ServerOptions): Promise<Server> {
  const trust = opts.trustProxy ?? "caddy";
  const origins = opts.corsOrigins ?? DEFAULT_CORS_ORIGINS;
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
      const cors = corsHeaders(req, origins);
      const reply = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): void => {
        res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...cors, ...headers });
        res.end(JSON.stringify(body));
      };
      const fail = (): void => reply(500, { ok: false });
      if (req.method === "OPTIONS") {
        const preflight = cors["access-control-allow-origin"]
          ? { "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "authorization, content-type, x-potyro-plan", "access-control-max-age": "600" }
          : {};
        res.writeHead(204, { ...cors, ...preflight });
        return void res.end();
      }
      if (over) return reply(413, { ok: false, error: "too big" });
      const method = req.method ?? "GET";
      const path = (req.url ?? "/").split("?")[0]!.replace(PREFIX, "");
      const body = Buffer.concat(chunks).toString("utf8");
      const ip = clientAddress(req.headers["x-forwarded-for"], req.socket.remoteAddress, trust);

      if (path === CHAT_PATH && opts.chat) {
        const header = (name: string): string | undefined => {
          const v = req.headers[name];
          return typeof v === "string" ? v : undefined;
        };
        // A client that goes away while OpenRouter has not answered yet stops the request upstream too.
        const left = new AbortController();
        res.on("close", () => res.writableFinished || left.abort());
        const chat = { method, body, ip, authorization: header("authorization"), plan: header("x-potyro-plan"), signal: left.signal };
        return void opts.chat(chat).then((r) => {
          if ("json" in r) return reply(r.status, r.json, r.headers);
          res.writeHead(r.status, { "cache-control": "no-store", ...cors, ...r.headers });
          res.flushHeaders();
          return pipe(r.stream, res);
        }, fail);
      }
      if (path === COUNT_PATH && opts.counts) {
        try {
          const r = opts.counts({ method, body, ip });
          return reply(r.status, r.body);
        } catch {
          return fail();
        }
      }
      opts.handle({ method, path, body, ip }).then((r) => reply(r.status, r.body), fail);
    });
  });
  return new Promise((resolve) => server.listen(opts.port, opts.host, () => resolve(server)));
}

const HEADERS = (key: string): Record<string, string> => ({
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  "HTTP-Referer": "https://github.com/fuzue/potyro",
  "X-Title": "Potyro (free AI)",
});

export function openRouter(key: string, fetchImpl: typeof fetch = fetch): (body: Record<string, unknown>) => Promise<UpstreamReply> {
  return async (body) => {
    const res = await fetchImpl(OPENROUTER_URL, { method: "POST", headers: HEADERS(key), body: JSON.stringify(body), signal: AbortSignal.timeout(UPSTREAM_MS) });
    return readOpenRouterReply(res.status, await res.text());
  };
}

/** The chat route's upstream: OpenRouter's answer as a Response, its body unread, for piping. */
export function openRouterChat(key: string, fetchImpl: typeof fetch = fetch): (body: Record<string, unknown>, signal?: AbortSignal) => Promise<Response> {
  return (body, signal) => {
    const timeout = AbortSignal.timeout(CHAT_UPSTREAM_MS);
    return fetchImpl(OPENROUTER_URL, { method: "POST", headers: HEADERS(key), body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  };
}

/** The kill switch: asked on every request, so turning it on needs no redeploy. */
export function killSwitch(env: Record<string, string | undefined>, exists: (path: string) => boolean = existsSync): () => boolean {
  return () => {
    if (env.AI_CHAT_OFF === "1") return true;
    const file = env.AI_CHAT_OFF_FILE;
    return Boolean(file) && exists(file!);
  };
}

const num = (name: string): number | undefined => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
};

const defined = <T extends object>(pairs: ReadonlyArray<readonly [keyof T, number | undefined]>): Partial<T> =>
  Object.fromEntries(pairs.filter(([, v]) => v !== undefined)) as Partial<T>;

const list = (raw: string | undefined): string[] | undefined => {
  const items = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
};

async function main(): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error("OPENROUTER_API_KEY is not set: the relay pays for the free allowance with it, and will not start without it.");
    process.exit(1);
  }
  const trustProxy = readTrustProxy(process.env.TRUST_PROXY);
  const file = process.env.AI_LEDGER ?? "./ai-ledger.json";
  // A ledger that cannot be read stops the relay rather than starting the month again at zero.
  const initial = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as never) : null;
  // A request that settles after its month or day ended is not counted (ledger.ts): say how often.
  const onStale = (n: number): void => console.error(`[ai-relay] a request settled after its month or day ended and was not counted (${n} so far)`);
  const ledger = persistentLedger(
    initial,
    (s) => {
      writeFileSync(`${file}.tmp`, JSON.stringify(s));
      renameSync(`${file}.tmp`, file);
    },
    { onStale },
  );
  const monthlyUsd = num("AI_MONTHLY_CAP_USD");
  // One budget for both routes: the caps count every request still out, on either.
  const budget = createBudget({ now: Date.now, ledger, monthlyUsd: monthlyUsd ?? DEFAULT_MONTHLY_USD, dayUsd: num("AI_DAY_USD") });
  const prices = readModelPrices(process.env.AI_MODEL_PRICES);
  const limits = defined<Limits>([
    ["monthlyUsd", monthlyUsd],
    ["perDeviceDay", num("AI_PER_DEVICE_DAY")],
    ["perDeviceMonth", num("AI_PER_DEVICE_MONTH")],
    ["perAddressDay", num("AI_PER_ADDRESS_DAY")],
  ]);
  const chatLimits = defined<ChatLimits>([
    ["monthlyUsd", monthlyUsd],
    ["deviceMonthUsd", num("AI_DEVICE_MONTH_USD")],
    ["addressDayUsd", num("AI_ADDRESS_DAY_USD")],
    ["reserveUsd", num("AI_CHAT_RESERVE_USD")],
    ["maxTokens", num("AI_CHAT_MAX_TOKENS")],
  ]);
  const model = process.env.AI_MODEL || AI_MODEL;
  const models = list(process.env.AI_CHAT_MODELS) ?? CHAT_MODELS;
  // Never the request, the device or the address: the upstream's status or message only.
  const onError = (e: unknown): void => console.error("[ai-relay]", e instanceof Error ? e.message : e);
  const relay = createAiRelay({ upstream: openRouter(key), now: Date.now, ledger, budget, limits, model, prices, onError });
  const chat = createChatProxy({ upstream: openRouterChat(key), now: Date.now, ledger, budget, limits: chatLimits, models, prices, isOff: killSwitch(process.env), onError });
  const counts = createCounts({ now: Date.now, ledger, perAddressDay: num("AI_COUNT_PER_ADDRESS_DAY") });
  const port = Number(process.env.PORT ?? 4204);
  const host = process.env.HOST ?? "127.0.0.1";
  const corsOrigins = list(process.env.AI_CORS_ORIGINS) ?? DEFAULT_CORS_ORIGINS;
  await startServer({ handle: relay.handle, chat: chat.handle, counts: counts.handle, port, host, trustProxy, corsOrigins });
  console.log(`[ai-relay] ${model}; chat ${models.join(", ")}; cap $${budget.monthlyUsd} a month, $${budget.dayUsd} a day; proxy ${trustProxy}; listening on ${host}:${port}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
