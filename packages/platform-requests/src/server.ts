// The relay as a process: `node --experimental-strip-types src/server.ts` on Node 22 (docs/16).
//
//   GITHUB_TOKEN           required — fine-grained, Issues read/write on the one repository
//   POTYRO_REQUESTS_REPO   default potyro-app/potyro
//   TRUST_PROXY            default caddy — whose X-Forwarded-For to believe (address.ts); `none` for none
//   PORT                   default 4202
//   HOST                   default 127.0.0.1 — reachable only through the proxy in front of it
//
// Behind the site's proxy (Caddy on potyro.app), on the same origin as the site (`/requests/` → here),
// so the browser needs no CORS. Whose address a request is comes from the proxy (address.ts, #348):
// the LAST `X-Forwarded-For` entry, the one the proxy wrote; anything before it is whatever the client
// sent. Bound to loopback, only the proxy reaches it.

import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { clientAddress, readTrustProxy, type TrustProxy } from "./address.ts";
import { createRelay, type RelayRequest, type RelayResponse } from "./relay.ts";
import { githubIssues } from "./github.ts";
import { LIMITS } from "./request.ts";

/** A prefix the proxy may leave on the path (`/requests/platform-requests` → `/platform-requests`). */
const PREFIX = /^\/requests(?=\/)/;

export function startServer(opts: { handle: (req: RelayRequest) => Promise<RelayResponse>; port: number; host: string; trustProxy?: TrustProxy }): Promise<Server> {
  const trust = opts.trustProxy ?? "caddy";
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > LIMITS.bytes) over = true;
      else chunks.push(chunk);
    });
    req.on("end", () => {
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
          ip: clientAddress(req.headers["x-forwarded-for"], req.socket.remoteAddress, trust),
        })
        .then(reply, () => reply({ status: 500, body: { ok: false } }));
    });
  });
  return new Promise((resolve) => server.listen(opts.port, opts.host, () => resolve(server)));
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN is not set: the relay files issues with it, and will not start without it.");
    process.exit(1);
  }
  const repo = process.env.POTYRO_REQUESTS_REPO ?? "potyro-app/potyro";
  const port = Number(process.env.PORT ?? 4202);
  const host = process.env.HOST ?? "127.0.0.1";
  let trustProxy: TrustProxy;
  try {
    trustProxy = readTrustProxy(process.env.TRUST_PROXY);
  } catch (e) {
    console.error(`[platform-requests] ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  const relay = createRelay({ issues: githubIssues({ token, repo }), now: Date.now, onError: (e) => console.error("[platform-requests]", e) });
  await startServer({ handle: relay.handle, port, host, trustProxy });
  console.log(`[platform-requests] filing into ${repo}, listening on ${host}:${port}, trusting ${trustProxy}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
