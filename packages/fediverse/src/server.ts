// The gallery's fediverse account as a process: `node --experimental-strip-types src/server.ts` on
// Node 22 (docs/16, docs/33).
//
//   FEDI_DATA_DIR            required — where the account's key, followers and queue are kept
//   FEDI_FEED                the gallery's feed — default /site/apps/feed.json (potyro.com's web root, mounted)
//   FEDI_ORIGIN              default https://potyro.com — the account is @<name>@<this host>, and every
//                            address of it is under <origin>/fedi/. It cannot change once anyone follows
//   FEDI_USERNAME            default apps — the account's name: @apps@potyro.com. Cannot change either
//   FEDI_NAME                default "Potyro apps" — the name shown beside it
//   FEDI_SUMMARY             the line under the name
//   FEDI_PROFILE_URL         default <origin>/apps/ — the page a person is sent to
//   FEDI_ASSETS              default <origin>/ — what the feed's picture paths are under
//   FEDI_ICON                default https://potyro.app/icon-512.png — the account's picture (PNG or JPEG)
//   FEDI_FEED_SECONDS        default 60 — how often the feed is looked at
//   FEDI_DELIVER_SECONDS     default 15 — how often what is due is sent
//   FEDI_REQUESTS_PER_ADDRESS_MINUTE  default 300
//   FEDI_LOOKUPS_PER_MINUTE  default 60 — accounts looked up on other servers, all senders together
//   FEDI_LOOKUPS_PER_ADDRESS_MINUTE   default 6 — and from one sending address (IPv6: its /64)
//   FEDI_MAX_FOLLOWERS       default 20000
//   FEDI_MAX_FOLLOWERS_PER_HOST       default 5000 — from one server
//   TRUST_PROXY              default caddy — whose X-Forwarded-For to believe (address.ts); `none` for none
//   PORT                     default 4207
//   HOST                     default 127.0.0.1 — reachable only through the proxy in front of it
//
// Behind the site's proxy on the site's own name (`/.well-known/webfinger` and `/fedi/*` → here).
// It holds no secret in its environment: its one secret is the key it makes itself, in FEDI_DATA_DIR.
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { clientAddress, readTrustProxy, type TrustProxy } from "./address.ts";
import { DEFAULT_LIMITS, type Limits } from "./core.ts";
import { diskStore } from "./disk.ts";
import { createFediverse, type FediRequest, type FediResponse, type Fediverse, type Profile } from "./fediverse.ts";
import { readFeed } from "./feed.ts";
import { requestOverHttps } from "./net.ts";

/** The most a request may carry: a little over the inbox's own limit, which answers the rest. */
const MAX_REQUEST_BYTES = DEFAULT_LIMITS.inboxBytes + 4_000;

export function startServer(opts: { handle: (req: FediRequest) => Promise<FediResponse>; port: number; host: string; trustProxy?: TrustProxy }): Promise<Server> {
  const trust = opts.trustProxy ?? "caddy";
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) over = true;
      else chunks.push(chunk);
    });
    req.on("end", () => {
      const reply = (r: FediResponse): void => {
        res.writeHead(r.status, r.headers);
        res.end(req.method === "HEAD" ? undefined : r.body);
      };
      if (over) return reply({ status: 413, headers: { "content-type": "application/json" }, body: '{"error":"too big"}' });
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v[0] : v;
      const [path, ...rest] = (req.url ?? "/").split("?");
      opts
        .handle({
          method: req.method ?? "GET",
          path: path!,
          query: rest.length ? `?${rest.join("?")}` : "",
          headers,
          body: new Uint8Array(Buffer.concat(chunks)),
          ip: clientAddress(req.headers["x-forwarded-for"], req.socket.remoteAddress, trust),
        })
        .then(reply, () => reply({ status: 500, headers: { "content-type": "application/json" }, body: '{"error":"something went wrong here"}' }));
    });
  });
  return new Promise((resolve) => server.listen(opts.port, opts.host, () => resolve(server)));
}

type Env = Record<string, string | undefined>;

/** A whole number above 0 from the environment, or the default; anything else stops the service. */
export function readCount(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a whole number above 0, got "${raw}"`);
  return n;
}

export function readLimits(env: Env): Partial<Limits> {
  return {
    requestsPerMinute: readCount(env, "FEDI_REQUESTS_PER_ADDRESS_MINUTE", DEFAULT_LIMITS.requestsPerMinute),
    lookupsPerMinute: readCount(env, "FEDI_LOOKUPS_PER_MINUTE", DEFAULT_LIMITS.lookupsPerMinute),
    lookupsPerAddressMinute: readCount(env, "FEDI_LOOKUPS_PER_ADDRESS_MINUTE", DEFAULT_LIMITS.lookupsPerAddressMinute),
    maxFollowers: readCount(env, "FEDI_MAX_FOLLOWERS", DEFAULT_LIMITS.maxFollowers),
    maxFollowersPerHost: readCount(env, "FEDI_MAX_FOLLOWERS_PER_HOST", DEFAULT_LIMITS.maxFollowersPerHost),
  };
}

export const DEFAULT_SUMMARY = "Small apps to try in your browser and make your own, from the Potyro gallery. This account posts each new one. It is automated and reads no replies.";

/** Who the account is, from the environment. */
export function readProfile(env: Env): Profile {
  const origin = (env.FEDI_ORIGIN || "https://potyro.com").replace(/\/+$/, "");
  return {
    origin,
    username: env.FEDI_USERNAME || "apps",
    name: env.FEDI_NAME || "Potyro apps",
    summary: env.FEDI_SUMMARY || DEFAULT_SUMMARY,
    profileUrl: env.FEDI_PROFILE_URL || `${origin}/apps/`,
    assets: env.FEDI_ASSETS || `${origin}/`,
    icon: env.FEDI_ICON || "https://potyro.app/icon-512.png",
  };
}

/**
 * Looks at the feed file and hands a new one to the account. A file that is missing, cut short or
 * wrong changes nothing: it is said once, and the account stays as it was until a good one comes.
 */
export function feedWatcher(fedi: Pick<Fediverse, "sync">, path: string, say: (message: string) => void, read: (path: string) => Promise<string> = (p) => readFile(p, "utf8")): () => Promise<void> {
  let seen: string | null = null;
  let complaint = "";
  let looking = false;
  return async () => {
    if (looking) return;
    looking = true;
    try {
      const text = await read(path);
      if (text === seen) return;
      const result = await fedi.sync(readFeed(JSON.parse(text)));
      seen = text;
      complaint = "";
      const changes = result.created.length + result.updated.length + result.deleted.length;
      if (changes) say(`feed: ${result.created.length} new, ${result.updated.length} changed, ${result.deleted.length} gone`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message !== complaint) say(`feed not taken (${path}): ${message}`);
      complaint = message;
    } finally {
      looking = false;
    }
  };
}

async function main(): Promise<void> {
  const say = (message: string): void => console.log(`[fediverse] ${message}`);
  const fail = (message: string): never => {
    console.error(`[fediverse] ${message}`);
    process.exit(1);
  };
  const env = process.env;
  const dir = env.FEDI_DATA_DIR || fail("FEDI_DATA_DIR is not set: the account's key and followers are kept there, and it will not start without it.");
  const feedPath = env.FEDI_FEED || "/site/apps/feed.json";
  let fedi: Fediverse;
  let trustProxy: TrustProxy;
  let every: { feed: number; deliver: number };
  const profile = readProfile(env);
  try {
    trustProxy = readTrustProxy(env.TRUST_PROXY);
    every = { feed: readCount(env, "FEDI_FEED_SECONDS", 60), deliver: readCount(env, "FEDI_DELIVER_SECONDS", 15) };
    fedi = await createFediverse({
      profile,
      store: diskStore(dir),
      outbound: requestOverHttps,
      limits: readLimits(env),
      // The error's message only: never a request or its headers.
      onError: (e) => console.error("[fediverse]", e instanceof Error ? e.message : e),
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  const watch = feedWatcher(fedi, feedPath, say);
  await watch();
  setInterval(() => void watch(), every.feed * 1000).unref();
  const deliver = (): void =>
    void fedi.deliver().then(
      (round) => round.unfollowed && say(`${round.unfollowed} followers on servers that are gone were removed`),
      (e) => console.error("[fediverse]", e instanceof Error ? e.message : e),
    );
  setInterval(deliver, every.deliver * 1000).unref();
  const port = Number(env.PORT ?? 4207);
  const host = env.HOST ?? "127.0.0.1";
  await startServer({ handle: fedi.handle, port, host, trustProxy });
  say(`@${profile.username}@${new URL(profile.origin).host}, kept in ${dir}, feed ${feedPath}, listening on ${host}:${port}, trusting ${trustProxy}; ${fedi.followers()} followers, ${fedi.waiting()} deliveries waiting`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
