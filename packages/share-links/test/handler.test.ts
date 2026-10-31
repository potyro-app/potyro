import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createShareHandler, dayCounts, DEFAULT_LIMITS, wideKey, type Limits, type ShareRequest, type ShareResponse } from "../src/handler.ts";
import { addressKey } from "../src/address.ts";
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

const ADMIN = "an-operator-token-that-is-long-enough-0123456789";

function service(opts: { limits?: Partial<Limits>; now?: () => number; adminToken?: string; abuseContact?: string; freeBytes?: () => Promise<number> } = {}) {
  const store = memoryShareStore();
  const handle = createShareHandler({
    store,
    indexHtml: async () => INDEX,
    publicOrigin: "https://apps.example",
    limits: opts.limits,
    now: opts.now,
    adminToken: opts.adminToken,
    abuseContact: opts.abuseContact,
    freeBytes: opts.freeBytes,
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
    const { handle } = service({ limits: { createsPerDay: 2 } });
    expect((await create(handle)).res.status).toBe(201);
    expect((await create(handle)).res.status).toBe(201);
    const third = await create(handle);
    expect(third.res.status).toBe(429);
    expect(third.out).toMatchObject({ ok: false, code: "too-many-links" });
    expect(third.out.error).toMatch(/Try again tomorrow/);
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

const body = (r: ShareResponse) => JSON.parse(String(r.body)) as Record<string, unknown>;
const takeDown = (handle: ReturnType<typeof service>["handle"], id: string, token: string | null, reason = "notice 2026-11-02: unlawful content", ip = "1.2.3.4") =>
  handle(
    req({
      method: "DELETE",
      path: `/share-api/admin/shares/${id}`,
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
      body: enc({ reason }),
      ip,
    }),
  );

describe("taking a link down, as the operator (#11)", () => {
  it("answers 410 everywhere after, and serves nothing of what the link was", async () => {
    const { handle, store } = service({ adminToken: ADMIN, abuseContact: "abuse@apps.example" });
    const { out } = await create(handle);

    const done = await takeDown(handle, out.id, ADMIN);
    expect(done.status).toBe(200);
    expect(body(done)).toEqual({ ok: true, id: out.id });
    expect(await store.takenDown(out.id)).toMatchObject({ reason: "notice 2026-11-02: unlawful content" });
    expect(await store.get(out.id)).toBeNull();
    expect(await store.payload(out.id)).toBeNull();

    const page = await handle(req({ path: `/s/${out.id}` }));
    expect(page.status).toBe(410);
    expect(page.headers["content-type"]).toMatch(/text\/html/);
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.headers["content-security-policy"]).toMatch(/default-src 'none'/);
    const html = String(page.body);
    expect(html).toContain("This link was taken down.");
    expect(html).toContain(`<a href="mailto:abuse@apps.example">abuse@apps.example</a>`);
    // Not the shell, and nothing of the link: no title, no preview tags, no script.
    expect(html).not.toContain("Groceries");
    expect(html).not.toContain("og:");
    expect(html).not.toContain("<script");

    const image = await handle(req({ path: `/s/${out.id}/preview.jpg` }));
    expect(image.status).toBe(410);
    expect(image.headers["content-type"]).toMatch(/text\/plain/);
    expect(image.body).not.toEqual(JPEG);

    const payload = await handle(req({ path: `/share-api/shares/${out.id}/payload` }));
    expect(payload.status).toBe(410);
    expect(body(payload)).toMatchObject({ ok: false, code: "taken-down" });

    // The sharer's own token cannot bring it back or make it a 404.
    const mine = await handle(req({ method: "DELETE", path: `/share-api/shares/${out.id}`, headers: { "x-delete-token": out.deleteToken } }));
    expect(mine.status).toBe(410);

    expect(body(await takeDown(handle, out.id, ADMIN))).toMatchObject({ ok: true, already: true });
  });

  it("works under a prefix, and the page leads back to the site", async () => {
    const { handle } = service({ adminToken: ADMIN });
    const { out } = await create(handle);
    await takeDown(handle, out.id, ADMIN);
    const html = String((await handle(req({ path: `/potyro/s/${out.id}` }))).body);
    expect(html).toContain(`<a class="home" href="/potyro/">Go to Potyro</a>`);
    // Without a report address, the page names none rather than a wrong one.
    expect(html).not.toContain("mailto:");
  });

  it("speaks the visitor's language, and escapes the address it names", async () => {
    const { handle } = service({ adminToken: ADMIN, abuseContact: `x"><script>@a.example` });
    const { out } = await create(handle);
    await takeDown(handle, out.id, ADMIN);
    const pl = String((await handle(req({ path: `/s/${out.id}`, headers: { "accept-language": "fr-FR;q=0.9, pl;q=0.8, en;q=0.1" } }))).body);
    expect(pl).toContain(`<html lang="pl">`);
    expect(pl).toContain("Ten link został zablokowany.");
    expect(pl).not.toContain(`"><script>`);
    const br = String((await handle(req({ path: `/s/${out.id}`, headers: { "accept-language": "pt-BR" } }))).body);
    expect(br).toContain("Este link foi tirado do ar.");
    const fr = String((await handle(req({ path: `/s/${out.id}`, headers: { "accept-language": "fr" } }))).body);
    expect(fr).toContain(`<html lang="en">`);
  });

  it("needs the operator's token, compared whole", async () => {
    const { handle, store } = service({ adminToken: ADMIN });
    const { out } = await create(handle);
    for (const token of [null, "", ADMIN.slice(0, -1), `${ADMIN}x`, out.deleteToken]) {
      const r = await takeDown(handle, out.id, token);
      expect(r.status).toBe(401);
      expect(body(r)).toMatchObject({ ok: false, code: "not-allowed" });
    }
    // The token is never echoed back.
    expect(String((await takeDown(handle, out.id, "wrong")).body)).not.toContain(ADMIN);
    expect(await store.takenDown(out.id)).toBeNull();
    expect((await handle(req({ path: `/s/${out.id}` }))).status).toBe(200);
  });

  it("counts wrong tokens against the sender's address", async () => {
    const { handle } = service({ adminToken: ADMIN, limits: { adminFailuresPerDay: 2 } });
    const { out } = await create(handle);
    expect((await takeDown(handle, out.id, "nope")).status).toBe(401);
    expect((await takeDown(handle, out.id, "nope")).status).toBe(401);
    const third = await takeDown(handle, out.id, "nope");
    expect(third.status).toBe(429);
    expect(body(third)).toMatchObject({ code: "too-many-tries" });
    // The right token from another address still works.
    expect((await takeDown(handle, out.id, ADMIN, "why", "5.6.7.8")).status).toBe(200);
  });

  it("refuses an address out of tries before comparing its token: the right one too", async () => {
    const { handle, store } = service({ adminToken: ADMIN, limits: { adminFailuresPerDay: 2 } });
    const { out } = await create(handle);
    expect((await takeDown(handle, out.id, "guess-1")).status).toBe(401);
    expect((await takeDown(handle, out.id, "guess-2")).status).toBe(401);
    // A guess that happens to be right, past the limit, gets what every other guess gets.
    const right = await takeDown(handle, out.id, ADMIN);
    expect(right.status).toBe(429);
    expect(body(right)).toMatchObject({ code: "too-many-tries" });
    expect(await store.takenDown(out.id)).toBeNull();
    // A right token only counts nothing: the operator, from a fresh address, uses up no tries.
    for (let i = 0; i < 3; i++) expect((await takeDown(handle, "A".repeat(22), ADMIN, "why", "5.6.7.8")).status).toBe(404);
  });

  it("says when there is no such link, and wants a JSON body", async () => {
    const { handle } = service({ adminToken: ADMIN });
    const missing = await takeDown(handle, "A".repeat(22), ADMIN);
    expect(missing.status).toBe(404);
    expect(body(missing)).toMatchObject({ code: "not-found" });
    const { out } = await create(handle);
    const bad = await handle(req({ method: "DELETE", path: `/share-api/admin/shares/${out.id}`, headers: { authorization: `Bearer ${ADMIN}` }, body: new TextEncoder().encode("{") }));
    expect(bad.status).toBe(400);
    expect(body(bad)).toMatchObject({ code: "not-json" });
  });

  it("has no takedown route without an operator token, and refuses a short one", async () => {
    const { handle } = service();
    const { out } = await create(handle);
    expect((await takeDown(handle, out.id, "anything")).status).toBe(404);
    expect(() => createShareHandler({ store: memoryShareStore(), indexHtml: async () => INDEX, adminToken: "short" })).toThrow(/at least 32/);
  });
});

describe("per-address limits a day (#119)", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("limits opening packages and loading link pages, each on its own", async () => {
    const { handle } = service({ limits: { payloadsPerDay: 2, pagesPerDay: 3 } });
    const { out } = await create(handle);
    const open = () => handle(req({ path: `/share-api/shares/${out.id}/payload` }));
    expect((await open()).status).toBe(200);
    expect((await open()).status).toBe(200);
    const refusedOpen = await open();
    expect(refusedOpen.status).toBe(429);
    expect(refusedOpen.headers["content-type"]).toBe("application/json");
    expect(body(refusedOpen)).toMatchObject({ ok: false, code: "too-many-opens" });
    expect(Number(refusedOpen.headers["retry-after"])).toBeGreaterThan(0);

    expect((await handle(req({ path: `/s/${out.id}` }))).status).toBe(200);
    expect((await handle(req({ path: `/s/${out.id}/preview.jpg` }))).status).toBe(200);
    expect((await handle(req({ method: "HEAD", path: `/s/${out.id}` }))).status).toBe(200);
    const refusedPage = await handle(req({ path: `/s/${out.id}` }));
    expect(refusedPage.status).toBe(429);
    expect(refusedPage.headers["content-type"]).toMatch(/text\/html/);
    // A picture is fetched by a chat app, not read by a person: it stays JSON.
    const refusedPicture = await handle(req({ path: `/s/${out.id}/preview.jpg` }));
    expect(refusedPicture.status).toBe(429);
    expect(body(refusedPicture)).toMatchObject({ code: "too-many-pages" });

    // Health is never limited; another address has its own day.
    expect((await handle(req({ path: "/share-api/health" }))).status).toBe(200);
    expect((await handle(req({ path: `/s/${out.id}`, ip: "5.6.7.8" }))).status).toBe(200);
  });

  it("answers a person's browser over the pages limit with a page in their language, and when to try again", async () => {
    // 21:30 UTC: the counts start again in two and a half hours, "about 3".
    const { handle } = service({ limits: { pagesPerDay: 1 }, now: () => Date.UTC(2026, 10, 2, 21, 30) });
    const { out } = await create(handle);
    expect((await handle(req({ path: `/potyro/s/${out.id}` }))).status).toBe(200);
    const page = await handle(req({ path: `/potyro/s/${out.id}`, headers: { "accept-language": "de-DE,de;q=0.9" } }));
    expect(page.status).toBe(429);
    expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(page.headers["retry-after"]).toBe(String(150 * 60));
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.headers["content-security-policy"]).toMatch(/default-src 'none'/);
    const html = String(page.body);
    expect(html).toContain(`<html lang="de">`);
    expect(html).toContain("Aus diesem Netz wurden heute zu viele Links geöffnet.");
    expect(html).toContain("in etwa 3 Stunden");
    expect(html).toContain(`<a class="home" href="/potyro/">Zu Potyro</a>`);
    // Words for a person, not the API's: no JSON, no code, no script.
    expect(html).not.toContain("too-many-pages");
    expect(html).not.toContain(`"ok"`);
    expect(html).not.toContain("<script");
    for (const [lang, words] of [
      ["en", "Try again in about 3 hours, or on another network."],
      ["pt-BR", "Tente de novo daqui a umas 3 horas"],
      ["es", "Vuelve a intentarlo en unas 3 horas"],
      ["it", "Riprova tra circa 3 ore"],
      ["pl", "Spróbuj ponownie za około 3 godziny"],
    ]) {
      expect(String((await handle(req({ path: `/s/${out.id}`, headers: { "accept-language": lang! } }))).body)).toContain(words);
    }
  });

  it("counts an IPv6 /48 too, at eight times each limit, so many /64s are not many addresses", async () => {
    const { handle } = service({ limits: { pagesPerDay: 1 } });
    const { out } = await create(handle);
    const page = (ip: string) => handle(req({ path: `/s/${out.id}`, ip }));
    for (let i = 0; i < 8; i++) expect((await page(`2001:db8:7:${i.toString(16)}::1`)).status).toBe(200);
    // The ninth /64 of the same /48 has had nothing yet, but its /48 is used up.
    expect((await page("2001:db8:7:ff::1")).status).toBe(429);
    // Another /48 has its own; IPv4 has no wider count.
    expect((await page("2001:db8:8:1::1")).status).toBe(200);
    expect(wideKey(addressKey("2001:db8:7:ff::1"))).toBe("2001:db8:7::/48");
    expect(wideKey(addressKey("1.2.3.4"))).toBeNull();
  });

  it("caps the bytes the whole service keeps a day, without spending anyone's own count", async () => {
    const size = 3 + JPEG.byteLength;
    const { handle } = service({ limits: { storedBytesPerDay: size * 2, createsPerDay: 3 } });
    expect((await create(handle, upload(), "1.1.1.1")).res.status).toBe(201);
    expect((await create(handle, upload(), "2.2.2.2")).res.status).toBe(201);
    const full = await create(handle, upload(), "3.3.3.3");
    expect(full.res.status).toBe(503);
    expect(full.out).toMatchObject({ ok: false, code: "full-today" });
    expect(Number(full.res.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("makes no new link while the disk would be left with less than its floor free", async () => {
    let free = 5_000_000_000;
    const { handle } = service({ freeBytes: async () => free });
    expect((await create(handle)).res.status).toBe(201);
    free = DEFAULT_LIMITS.minFreeBytes + 5;
    const low = await create(handle);
    expect(low.res.status).toBe(503);
    expect(low.out).toMatchObject({ ok: false, code: "no-room" });
    // Opening links already made still works.
    expect((await handle(req({ path: "/share-api/health" }))).status).toBe(200);
  });

  it("counts an IPv6 /64 as one address, and an IPv4 written as IPv6 as itself", async () => {
    const { handle } = service({ limits: { pagesPerDay: 2 } });
    const { out } = await create(handle);
    const page = (ip: string) => handle(req({ path: `/s/${out.id}`, ip }));
    expect((await page("2001:db8:1:2::1")).status).toBe(200);
    expect((await page("2001:db8:1:2:ffff::9")).status).toBe(200);
    expect((await page("2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd")).status).toBe(429);
    expect((await page("2001:db8:1:3::1")).status).toBe(200);
    expect((await page("1.2.3.4")).status).toBe(200);
    expect((await page("::ffff:1.2.3.4")).status).toBe(200);
    expect((await page("1.2.3.4")).status).toBe(429);
  });

  it("starts every count again on a new day (UTC)", async () => {
    let t = Date.UTC(2026, 10, 2, 23, 59);
    const { handle } = service({ limits: { createsPerDay: 1 }, now: () => t });
    expect((await create(handle)).res.status).toBe(201);
    const refusedNow = await create(handle);
    expect(refusedNow.res.status).toBe(429);
    expect(refusedNow.res.headers["retry-after"]).toBe("60");
    t += 60_000;
    expect((await create(handle)).res.status).toBe(201);
  });

  it("holds a bounded number of addresses", () => {
    const counts = dayCounts(() => DAY, 3);
    for (const k of ["a", "b", "c", "d"]) expect(counts.take(k, 1)).toBe(true);
    expect(counts.size()).toBe(3);
    // "a" was let go to make room: it starts again; "d" is still counted.
    expect(counts.take("a", 1)).toBe(true);
    expect(counts.take("d", 1)).toBe(false);
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

  it("takes a link down on disk: the record stays, the share's files go", async () => {
    dir = mkdtempSync(join(tmpdir(), "shares-"));
    const store = diskShareStore(dir);
    const handle = createShareHandler({ store, indexHtml: async () => INDEX, adminToken: ADMIN });
    const { out } = await create(handle as ReturnType<typeof service>["handle"]);
    const folder = join(dir, out.id.slice(0, 2), out.id);
    expect(readdirSync(folder).sort()).toEqual(["meta.json", "payload.bin", "preview"]);
    expect((await takeDown(handle as ReturnType<typeof service>["handle"], out.id, ADMIN)).status).toBe(200);
    expect(readdirSync(folder)).toEqual(["taken-down.json"]);
    expect(JSON.parse(readFileSync(join(folder, "taken-down.json"), "utf8"))).toMatchObject({ reason: "notice 2026-11-02: unlawful content" });
    expect((await handle(req({ path: `/s/${out.id}` }))).status).toBe(410);
  });

  it("a sharer's delete takes only the share's files: a takedown that lands meanwhile keeps its record", async () => {
    dir = mkdtempSync(join(tmpdir(), "shares-"));
    const store = diskShareStore(dir);
    const handle = createShareHandler({ store, indexHtml: async () => INDEX });
    const { out } = await create(handle as ReturnType<typeof service>["handle"]);
    const folder = join(dir, out.id.slice(0, 2), out.id);
    // The takedown's record is written between the sharer's checks and the removal.
    writeFileSync(join(folder, "taken-down.json"), JSON.stringify({ at: "2026-11-02T10:00:00Z", reason: "notice" }));
    await store.remove(out.id);
    expect(readdirSync(folder)).toEqual(["taken-down.json"]);
    expect(await store.takenDown(out.id)).toMatchObject({ reason: "notice" });
    expect((await handle(req({ path: `/s/${out.id}` }))).status).toBe(410);

    // With nothing else there, the folder goes too.
    const other = await create(handle as ReturnType<typeof service>["handle"]);
    await store.remove(other.out.id);
    expect(existsSync(join(dir, other.out.id.slice(0, 2), other.out.id))).toBe(false);
    await store.remove(other.out.id); // twice is fine
  });
});
