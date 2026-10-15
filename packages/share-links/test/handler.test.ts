import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createShareHandler, type ShareRequest } from "../src/handler.ts";
import { memoryShareStore } from "../src/store.ts";
import { diskShareStore } from "../src/disk.ts";
import { startServer } from "../src/server.ts";
import { LIMITS, openPackage, sealPackage, toBase64 } from "../src/wire.ts";

const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="frame-src 'none'" />
    <title>Potyro</title>
  </head>
  <body><div id="root"></div><script type="module" src="/assets/main.js"></script></body>
</html>`;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const req = (over: Partial<ShareRequest>): ShareRequest => ({ method: "GET", path: "/", headers: { host: "apps.example" }, body: new Uint8Array(), ip: "1.2.3.4", ...over });

function service(opts: { perAddress?: number } = {}) {
  const store = memoryShareStore();
  const handle = createShareHandler({
    store,
    indexHtml: async () => INDEX,
    publicOrigin: "https://apps.example",
    limits: { perAddress: opts.perAddress ?? 30, windowMs: 1000 },
  });
  return { store, handle };
}

const upload = (over: Record<string, unknown> = {}) => ({
  meta: { title: "Groceries", description: "Try it in your browser", lang: "pl" },
  payload: toBase64(new Uint8Array([1, 2, 3])),
  image: toBase64(JPEG),
  ...over,
});

async function create(handle: ReturnType<typeof service>["handle"], body: unknown = upload(), ip = "1.2.3.4") {
  const res = await handle(req({ method: "POST", path: "/share-api/shares", body: enc(body), ip }));
  return { res, out: JSON.parse(String(res.body)) as { ok: boolean; id: string; deleteToken: string; error?: string } };
}

describe("the share service", () => {
  it("keeps a share and answers its link with preview meta for every network", async () => {
    const { handle } = service();
    const { res, out } = await create(handle);
    expect(res.status).toBe(201);
    expect(out.id).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const page = await handle(req({ path: `/s/${out.id}` }));
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toMatch(/text\/html/);
    expect(page.headers["x-robots-tag"]).toMatch(/noindex/);
    const html = String(page.body);
    expect(html).toContain(`<meta property="og:title" content="Groceries" />`);
    expect(html).toContain(`<meta property="og:image" content="https://apps.example/s/${out.id}/preview.jpg" />`);
    expect(html).toContain(`<meta name="twitter:card" content="summary_large_image" />`);
    expect(html).toContain(`<meta property="og:locale" content="pl" />`);
    expect(html).toContain(`<title>Groceries · Potyro</title>`);
    expect(html).not.toContain("<title>Potyro</title>");
    // The shell itself is untouched: its CSP and its script.
    expect(html).toContain(`content="frame-src 'none'"`);
    expect(html).toContain(`src="/assets/main.js"`);
    // The charset stays first in the head.
    expect(html.indexOf("charset")).toBeLessThan(html.indexOf("og:title"));

    const image = await handle(req({ path: `/s/${out.id}/preview.jpg` }));
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toBe("image/jpeg");
    expect(image.body).toEqual(JPEG);

    const payload = await handle(req({ path: `/share-api/shares/${out.id}/payload` }));
    expect(payload.body).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("escapes what it writes into the page", async () => {
    const { handle } = service();
    const { out } = await create(handle, upload({ meta: { title: `"><script>alert(1)</script>`, description: "a & b", lang: "en" } }));
    const html = String((await handle(req({ path: `/s/${out.id}` }))).body);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("a &amp; b");
  });

  it("refuses what it should not keep, before keeping anything", async () => {
    const { handle, store } = service();
    expect((await create(handle, upload({ meta: { title: "  " } }))).res.status).toBe(400);
    expect((await create(handle, upload({ payload: "" }))).res.status).toBe(400);
    expect((await create(handle, upload({ image: toBase64(new TextEncoder().encode("<svg onload=x>")) }))).res.status).toBe(400);
    const bigImage = new Uint8Array(LIMITS.imageBytes + 1);
    bigImage.set(JPEG);
    expect((await create(handle, upload({ image: toBase64(bigImage) }))).res.status).toBe(413);
    expect((await create(handle, upload({ payload: toBase64(new Uint8Array(LIMITS.payloadBytes + 1)) }))).res.status).toBe(413);
    const notJson = await handle(req({ method: "POST", path: "/share-api/shares", body: new TextEncoder().encode("{") }));
    expect(notJson.status).toBe(400);
    expect(store.size()).toBe(0);
  });

  it("limits how many shares one address makes", async () => {
    const { handle } = service({ perAddress: 2 });
    expect((await create(handle)).res.status).toBe(201);
    expect((await create(handle)).res.status).toBe(201);
    expect((await create(handle)).res.status).toBe(429);
    expect((await create(handle, upload(), "5.6.7.8")).res.status).toBe(201);
  });

  it("takes a share down only with its token", async () => {
    const { handle } = service();
    const { out } = await create(handle);
    const wrong = await handle(req({ method: "DELETE", path: `/share-api/shares/${out.id}`, headers: { "x-delete-token": "nope" } }));
    expect(wrong.status).toBe(403);
    const right = await handle(req({ method: "DELETE", path: `/share-api/shares/${out.id}`, headers: { "x-delete-token": out.deleteToken } }));
    expect(right.status).toBe(200);
    const gone = await handle(req({ path: `/s/${out.id}` }));
    // Still the shell — it says the link is gone — but nothing to preview.
    expect(gone.status).toBe(404);
    expect(String(gone.body)).toContain("<title>Potyro</title>");
    expect((await handle(req({ path: `/share-api/shares/${out.id}/payload` }))).status).toBe(404);
  });

  it("answers unknown or malformed paths with 404 and never builds a path from them", async () => {
    const { handle } = service();
    for (const path of ["/s/../../etc/passwd", "/share-api/shares/..%2f..%2fx/payload", "/share-api/nope", "/elsewhere"]) {
      expect((await handle(req({ path }))).status).toBe(404);
    }
    expect(JSON.parse(String((await handle(req({ path: "/share-api/health" }))).body))).toEqual({ ok: true });
  });

  it("works under a prefix the site is served from", async () => {
    const { handle } = service();
    const { out } = await create(handle);
    const html = String((await handle(req({ path: `/potyro/s/${out.id}` }))).body);
    expect(html).toContain(`https://apps.example/potyro/s/${out.id}/preview.jpg`);
  });
});

describe("sealing", () => {
  it("only the key in the link opens the package; the service holds ciphertext", async () => {
    const zip = new TextEncoder().encode("PK\u0003\u0004 the app and its demo records");
    const { key, sealed } = await sealPackage(zip);
    expect(new TextDecoder().decode(sealed)).not.toContain("demo records");
    expect(await openPackage(sealed, key)).toEqual(zip);
    const other = (await sealPackage(zip)).key;
    await expect(openPackage(sealed, other)).rejects.toThrow();
  });
});

describe("on disk, over HTTP", () => {
  let server: Server | null = null;
  let dir = "";
  afterEach(async () => {
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a share through the real server and the disk store", async () => {
    dir = mkdtempSync(join(tmpdir(), "shares-"));
    const handle = createShareHandler({ store: diskShareStore(dir), indexHtml: async () => INDEX });
    server = await startServer({ handle, port: 0, host: "127.0.0.1" });
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const made = await fetch(`${base}/share-api/shares`, { method: "POST", body: JSON.stringify(upload()), headers: { "x-forwarded-for": "9.9.9.9" } });
    expect(made.status).toBe(201);
    const { id } = (await made.json()) as { id: string };
    const page = await fetch(`${base}/s/${id}`);
    expect(await page.text()).toContain(`http://127.0.0.1:${port}/s/${id}/preview.jpg`);
    const image = new Uint8Array(await (await fetch(`${base}/s/${id}/preview.jpg`)).arrayBuffer());
    expect(image).toEqual(JPEG);
    const tooBig = await fetch(`${base}/share-api/shares`, { method: "POST", body: "x".repeat(LIMITS.requestBytes + 10) });
    expect(tooBig.status).toBe(413);
  });
});
