// The share service as a process: `node --experimental-strip-types src/server.ts` on Node 22 (docs/16).
//
//   POTYRO_SHARES_DIR      required — where shares are kept (one folder each)
//   POTYRO_SHELL_INDEX     the built shell's index.html — default /var/www/karta/index.html
//   POTYRO_PUBLIC_ORIGIN   https://potyro.app — what preview URLs are built on
//   PORT                   default 4203
//   HOST                   default 127.0.0.1 — reachable only through the proxy in front of it
//
// Behind Apache on the same origin as the site (`/s/…` and `/share-api/…` → here), so the shell needs
// no CORS. The sender's address is the LAST `X-Forwarded-For` entry:
// Apache appends the real peer, and anything before it is whatever the client sent (#348). Bound to
// loopback, only the proxy reaches it.
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createShareHandler, type ShareRequest, type ShareResponse } from "./handler.ts";
import { diskShareStore } from "./disk.ts";
import { LIMITS } from "./wire.ts";

export function startServer(opts: { handle: (req: ShareRequest) => Promise<ShareResponse>; port: number; host: string }): Promise<Server> {
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
      const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",").pop()!.trim();
      opts
        .handle({
          method: req.method ?? "GET",
          path: (req.url ?? "/").split("?")[0]!,
          headers,
          body: new Uint8Array(Buffer.concat(chunks)),
          ip: forwarded || req.socket.remoteAddress || "unknown",
        })
        .then(reply, () => reply({ status: 500, headers: { "content-type": "application/json" }, body: '{"ok":false}' }));
    });
  });
  return new Promise((resolve) => server.listen(opts.port, opts.host, () => resolve(server)));
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
  const handle = createShareHandler({
    store: diskShareStore(dir),
    indexHtml: () => readFile(index, "utf8"),
    publicOrigin: process.env.POTYRO_PUBLIC_ORIGIN,
    onError: (e) => console.error("[share-links]", e),
  });
  await startServer({ handle, port, host });
  console.log(`[share-links] keeping shares in ${dir}, page from ${index}, listening on ${host}:${port}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
