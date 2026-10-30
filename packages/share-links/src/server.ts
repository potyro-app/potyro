// The share service as a process: `node --experimental-strip-types src/server.ts` on Node 22 (docs/16).
//
//   POTYRO_SHARES_DIR              required — where shares are kept (one folder each)
//   POTYRO_SHELL_INDEX             the built shell's index.html — default /var/www/karta/index.html
//   POTYRO_PUBLIC_ORIGIN           https://potyro.app — what preview URLs are built on
//   SHARE_ADMIN_TOKEN              the operator's token for DELETE /share-api/admin/shares/<id> (at least 32
//                                  characters; `openssl rand -base64 33`). Unset: that route does not exist,
//                                  and links are taken down with scripts/takedown.mjs on the server (docs/16)
//   SHARE_ABUSE_CONTACT            the address a taken-down link's page says to write to (the terms' report address)
//   SHARE_CREATE_PER_ADDRESS_DAY   default 30 — links one address (IPv6: its /64) makes a day (UTC)
//   SHARE_PAYLOAD_PER_ADDRESS_DAY  default 300 — packages it fetches a day: one per demo opened
//   SHARE_PAGE_PER_ADDRESS_DAY     default 2000 — link pages and preview pictures it fetches a day
//   TRUST_PROXY                    default caddy — whose X-Forwarded-For to believe (address.ts); `none` for none
//   PORT                           default 4203
//   HOST                           default 127.0.0.1 — reachable only through the proxy in front of it
//
// Behind the site's proxy on the same origin as the site (`/s/…` and `/share-api/…` → here), so the
// shell needs no CORS. Whose address a request is comes from the proxy (address.ts, #348). Bound to
// loopback, only the proxy reaches it. The operator token is never logged.
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { clientAddress, readTrustProxy, type TrustProxy } from "./address.ts";
import { createShareHandler, MIN_ADMIN_TOKEN, type Limits, type ShareRequest, type ShareResponse } from "./handler.ts";
import { diskShareStore } from "./disk.ts";
import { LIMITS } from "./wire.ts";

export function startServer(opts: { handle: (req: ShareRequest) => Promise<ShareResponse>; port: number; host: string; trustProxy?: TrustProxy }): Promise<Server> {
  const trust = opts.trustProxy ?? "caddy";
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > LIMITS.requestBytes) over = true;
      else chunks.push(chunk);
    });
    req.on("end", () => {
      const reply = (r: ShareResponse): void => {
        res.writeHead(r.status, r.headers);
        res.end(req.method === "HEAD" ? undefined : r.body);
      };
      if (over) return reply({ status: 413, headers: { "content-type": "application/json" }, body: '{"ok":false,"error":"too big"}' });
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v[0] : v;
      opts
        .handle({
          method: req.method ?? "GET",
          path: (req.url ?? "/").split("?")[0]!,
          headers,
          body: new Uint8Array(Buffer.concat(chunks)),
          ip: clientAddress(req.headers["x-forwarded-for"], req.socket.remoteAddress, trust),
        })
        .then(reply, () => reply({ status: 500, headers: { "content-type": "application/json" }, body: '{"ok":false}' }));
    });
  });
  return new Promise((resolve) => server.listen(opts.port, opts.host, () => resolve(server)));
}

/** The per-address limits from the environment; a value that is not a whole number above 0 stops the service. */
export function readLimits(env: Record<string, string | undefined>): Partial<Limits> {
  const names: Array<[keyof Limits, string]> = [
    ["createsPerDay", "SHARE_CREATE_PER_ADDRESS_DAY"],
    ["payloadsPerDay", "SHARE_PAYLOAD_PER_ADDRESS_DAY"],
    ["pagesPerDay", "SHARE_PAGE_PER_ADDRESS_DAY"],
  ];
  const out: Partial<Limits> = {};
  for (const [key, name] of names) {
    const raw = env[name];
    if (raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a whole number above 0, got "${raw}"`);
    out[key] = n;
  }
  return out;
}

async function main(): Promise<void> {
  const dir = process.env.POTYRO_SHARES_DIR;
  if (!dir) {
    console.error("POTYRO_SHARES_DIR is not set: the share service keeps shares there, and will not start without it.");
    process.exit(1);
  }
  const index = process.env.POTYRO_SHELL_INDEX ?? "/var/www/karta/index.html";
  const port = Number(process.env.PORT ?? 4203);
  const host = process.env.HOST ?? "127.0.0.1";
  let trustProxy: TrustProxy;
  let limits: Partial<Limits>;
  try {
    trustProxy = readTrustProxy(process.env.TRUST_PROXY);
    limits = readLimits(process.env);
  } catch (e) {
    console.error(`[share-links] ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  const adminToken = process.env.SHARE_ADMIN_TOKEN || undefined;
  if (adminToken && adminToken.length < MIN_ADMIN_TOKEN) {
    // Said without the token: it is never printed.
    console.error(`[share-links] SHARE_ADMIN_TOKEN is shorter than ${MIN_ADMIN_TOKEN} characters; make a longer one (openssl rand -base64 33).`);
    process.exit(1);
  }
  const abuseContact = process.env.SHARE_ABUSE_CONTACT || undefined;
  const handle = createShareHandler({
    store: diskShareStore(dir),
    indexHtml: () => readFile(index, "utf8"),
    publicOrigin: process.env.POTYRO_PUBLIC_ORIGIN,
    adminToken,
    abuseContact,
    limits,
    // The error's message only: never a request, its headers or the operator's token.
    onError: (e) => console.error("[share-links]", e instanceof Error ? e.message : e),
  });
  await startServer({ handle, port, host, trustProxy });
  console.log(
    `[share-links] keeping shares in ${dir}, page from ${index}, listening on ${host}:${port}, trusting ${trustProxy}; ` +
      `operator takedown ${adminToken ? "on" : "off (no SHARE_ADMIN_TOKEN)"}; ${abuseContact ? "report address set" : "no SHARE_ABUSE_CONTACT: a taken-down link names no address"}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
