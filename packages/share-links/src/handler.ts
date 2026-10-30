// The share service (docs/24 §4), as a function from a request to a response: the HTTP server
// (server.ts) and the dev server's middleware (the shell's vite.config.ts) both call it.
//
//   GET    /share-api/health                → { ok: true }
//   POST   /share-api/shares                → { ok, id, deleteToken }      (a ShareUpload)
//   GET    /share-api/shares/<id>/payload   → the sealed package
//   DELETE /share-api/shares/<id>           → with `x-delete-token`: gone
//   DELETE /share-api/admin/shares/<id>     → with `authorization: Bearer <SHARE_ADMIN_TOKEN>`: taken down
//   GET    /s/<id>                          → the shell's page, with the link's preview meta
//   GET    /s/<id>/preview.jpg|.png         → the preview picture
//
// A link the operator took down answers 410 on every one of these, with nothing of what it was
// (docs/16, "Taking a link down"). Making links, opening packages and loading link pages are each
// limited per address per day (IPv6: per /64); a refusal is JSON with a `code` and a sentence.
//
// It never runs app code and cannot read a package: what it can read is what a preview shows.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { addressKey } from "./address.ts";
import { pageLanguage, sharePage, takenDownPage } from "./page.ts";
import type { ShareStore } from "./store.ts";
import { fromBase64, ID_RE, imageTypeOf, LIMITS, newShareId, readMeta, type ShareUpload } from "./wire.ts";

export interface ShareRequest {
  method: string;
  /** The path, without the query. A prefix in front (`/potyro/s/…`) is allowed. */
  path: string;
  headers: Record<string, string | undefined>;
  body: Uint8Array;
  /** The sender's address, as the proxy in front reports it. */
  ip: string;
}

export interface ShareResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array;
}

/** What one address (an IPv6 address: its /64) may do in a calendar day, UTC. */
export interface Limits {
  /** Links made (`POST /share-api/shares`). Only a request that would make a link counts. */
  createsPerDay: number;
  /** Packages fetched (`GET …/payload`, up to 2 MiB each): one per demo opened. */
  payloadsPerDay: number;
  /** Link pages and preview pictures (`GET /s/…`). Chat apps fetch these for their previews. */
  pagesPerDay: number;
  /** Takedowns sent with a wrong operator token. */
  adminFailuresPerDay: number;
}

export const DEFAULT_LIMITS: Limits = { createsPerDay: 30, payloadsPerDay: 300, pagesPerDay: 2000, adminFailuresPerDay: 10 };

/** At most this many addresses are counted at once; past it, the one counted longest ago is let go. */
export const MAX_COUNTED = 100_000;

/** The shortest operator token the service accepts: a guessable one would let anyone take links down. */
export const MIN_ADMIN_TOKEN = 32;

export interface HandlerDeps {
  store: ShareStore;
  /** The shell's index.html, as built: the page every link answers with. Read per request, so a deploy shows at once. */
  indexHtml: (path: string) => Promise<string>;
  /** `https://apps.example` — what preview URLs are built on. Else the request's own host. */
  publicOrigin?: string;
  now?: () => number;
  /** Over {@link DEFAULT_LIMITS}. */
  limits?: Partial<Limits>;
  /**
   * The operator's token for taking a link down (`SHARE_ADMIN_TOKEN`). Without one the takedown route
   * does not exist (404): links are then taken down with scripts/takedown.mjs on the server itself.
   */
  adminToken?: string;
  /** Where the page of a taken-down link says to write (`SHARE_ABUSE_CONTACT`). */
  abuseContact?: string;
  onError?: (e: unknown) => void;
}

/** The shell's own policy (docs/07, #272): the page a link answers with is the shell, and carries it too. */
const SHELL_CSP = "frame-src 'none'";

const json = (status: number, body: Record<string, unknown>): ShareResponse => ({
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Same length, compared in constant time: the hashes of the two, so their lengths say nothing. */
export function sameSecret(given: string, kept: string): boolean {
  return timingSafeEqual(createHash("sha256").update(given).digest(), createHash("sha256").update(kept).digest());
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Counts per key for the current calendar day (UTC), in memory. A new day starts every count again.
 * Holds at most `maxKeys` keys: past that, the key first counted longest ago is let go, which can only
 * let an old key start its day again, never hold back a new one.
 */
export function dayCounts(now: () => number, maxKeys = MAX_COUNTED) {
  let day = Math.floor(now() / DAY_MS);
  const counts = new Map<string, number>();
  return {
    /** Count one for `key` if it is under `max`; false (and nothing counted) when it is not. */
    take(key: string, max: number): boolean {
      const today = Math.floor(now() / DAY_MS);
      if (today !== day) {
        day = today;
        counts.clear();
      }
      const n = counts.get(key) ?? 0;
      if (n >= max) return false;
      if (n === 0 && counts.size >= maxKeys) counts.delete(counts.keys().next().value!);
      counts.set(key, n + 1);
      return true;
    },
    /** Seconds until the counts start again: what `retry-after` says. */
    secondsLeft(): number {
      return Math.max(1, Math.ceil(((Math.floor(now() / DAY_MS) + 1) * DAY_MS - now()) / 1000));
    },
    size: () => counts.size,
  };
}

/** A refusal: a code for the caller's program, a sentence for the person. */
const refused = (status: number, code: string, error: string, headers: Record<string, string> = {}): ShareResponse => {
  const r = json(status, { ok: false, code, error });
  return { ...r, headers: { ...r.headers, ...headers } };
};

const TAKEN_DOWN = "This link was taken down: the app behind it was removed from Potyro.";

/** What each per-address limit says when it is reached. */
const OVER: Record<keyof Omit<Limits, "adminFailuresPerDay">, { code: string; error: string }> = {
  createsPerDay: { code: "too-many-links", error: "Too many links were made from this address today. Try again tomorrow." },
  payloadsPerDay: { code: "too-many-opens", error: "Too many apps were opened from this address today. Try again tomorrow." },
  pagesPerDay: { code: "too-many-pages", error: "Too many link pages were loaded from this address today. Try again tomorrow." },
};

export function createShareHandler(deps: HandlerDeps): (req: ShareRequest) => Promise<ShareResponse> {
  const now = deps.now ?? Date.now;
  const limits: Limits = { ...DEFAULT_LIMITS, ...deps.limits };
  const counts = dayCounts(now);
  if (deps.adminToken !== undefined && deps.adminToken.length < MIN_ADMIN_TOKEN) {
    throw new Error(`the operator token must be at least ${MIN_ADMIN_TOKEN} characters`);
  }

  /** Count one against `limit` for this request's address; the refusal when it is used up. */
  const over = (req: ShareRequest, limit: keyof typeof OVER): ShareResponse | null => {
    if (counts.take(`${limit}:${addressKey(req.ip)}`, limits[limit])) return null;
    return refused(429, OVER[limit].code, OVER[limit].error, { "retry-after": String(counts.secondsLeft()) });
  };

  const originOf = (req: ShareRequest): string => {
    if (deps.publicOrigin) return deps.publicOrigin.replace(/\/+$/, "");
    const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
    const proto = req.headers["x-forwarded-proto"] ?? "http";
    return `${proto}://${host}`;
  };

  /** The page of a link the operator took down: not the shell, and nothing of the link. */
  const gonePage = (req: ShareRequest, prefix: string): ShareResponse => ({
    status: 410,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      // No script, no frame, nothing fetched: the page is its own text and inline style.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
    body: takenDownPage({ lang: pageLanguage(req.headers["accept-language"]), contact: deps.abuseContact, home: `${prefix}/` }),
  });

  const page = async (req: ShareRequest, prefix: string, id: string): Promise<ShareResponse> => {
    if (await deps.store.takenDown(id)) return gonePage(req, prefix);
    const html = await deps.indexHtml(req.path);
    const share = await deps.store.get(id);
    const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", "x-robots-tag": "noindex, nofollow", "content-security-policy": SHELL_CSP };
    // An unknown link still gets the shell, which says it is gone; it just has nothing to preview.
    if (!share) return { status: 404, headers, body: html };
    const origin = originOf(req);
    const ext = share.imageType === "image/png" ? "png" : "jpg";
    const body = sharePage(html, share.meta, {
      page: `${origin}${prefix}/s/${id}`,
      ...(share.imageType ? { image: `${origin}${prefix}/s/${id}/preview.${ext}`, imageType: share.imageType } : {}),
    });
    return { status: 200, headers, body };
  };

  const create = async (req: ShareRequest): Promise<ShareResponse> => {
    if (req.body.byteLength > LIMITS.requestBytes) return json(413, { ok: false, error: "too big" });
    let upload: ShareUpload;
    try {
      upload = JSON.parse(new TextDecoder().decode(req.body)) as ShareUpload;
    } catch {
      return json(400, { ok: false, error: "not JSON" });
    }
    let meta;
    try {
      meta = readMeta(upload?.meta);
    } catch (e) {
      return json(400, { ok: false, error: e instanceof Error ? e.message : "bad meta" });
    }
    let payload: Uint8Array;
    let image: Uint8Array | undefined;
    try {
      payload = fromBase64(String(upload.payload ?? ""));
      image = upload.image ? fromBase64(String(upload.image)) : undefined;
    } catch {
      return json(400, { ok: false, error: "not base64" });
    }
    if (payload.byteLength === 0) return json(400, { ok: false, error: "no package" });
    if (payload.byteLength > LIMITS.payloadBytes) return json(413, { ok: false, error: "package too big" });
    const imageType = image ? imageTypeOf(image) : null;
    if (image && !imageType) return json(400, { ok: false, error: "the picture is not a JPEG or PNG" });
    if (image && image.byteLength > LIMITS.imageBytes) return json(413, { ok: false, error: "picture too big" });
    // Counted only once it is a share we would keep: a malformed request costs nobody their quota.
    const tooMany = over(req, "createsPerDay");
    if (tooMany) return tooMany;
    const id = newShareId();
    const deleteToken = randomBytes(24).toString("base64url");
    await deps.store.put(
      id,
      { meta, createdAt: new Date(now()).toISOString(), deleteHash: sha256(deleteToken), ...(imageType ? { imageType } : {}) },
      payload,
      image,
    );
    return json(201, { ok: true, id, deleteToken });
  };

  const remove = async (req: ShareRequest, id: string): Promise<ShareResponse> => {
    if (await deps.store.takenDown(id)) return refused(410, "taken-down", TAKEN_DOWN);
    const share = await deps.store.get(id);
    if (!share) return json(404, { ok: false });
    const given = Buffer.from(sha256(req.headers["x-delete-token"] ?? ""), "hex");
    const kept = Buffer.from(share.deleteHash, "hex");
    if (given.length !== kept.length || !timingSafeEqual(given, kept)) return json(403, { ok: false });
    await deps.store.remove(id);
    return json(200, { ok: true });
  };

  /**
   * The operator's takedown. The token is compared in constant time and never written anywhere: not
   * in a response, not in a log. A wrong one counts against the sender's address.
   */
  const takeDown = async (req: ShareRequest, id: string): Promise<ShareResponse> => {
    if (!deps.adminToken) return json(404, { ok: false });
    const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
    if (!sameSecret(given, deps.adminToken)) {
      if (!counts.take(`adminFailuresPerDay:${addressKey(req.ip)}`, limits.adminFailuresPerDay)) {
        return refused(429, "too-many-tries", "Too many wrong tokens from this address today. Try again tomorrow.", { "retry-after": String(counts.secondsLeft()) });
      }
      return refused(401, "not-allowed", "Taking a link down needs the operator's token.");
    }
    if (await deps.store.takenDown(id)) return json(200, { ok: true, id, already: true });
    if (!(await deps.store.get(id))) return refused(404, "not-found", "There is no link with this id: it was never made, or whoever made it removed it.");
    let reason = "";
    try {
      const body = req.body.byteLength ? (JSON.parse(new TextDecoder().decode(req.body)) as { reason?: unknown }) : {};
      reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 2000) : "";
    } catch {
      return refused(400, "not-json", "The body must be JSON, like {\"reason\": \"…\"}.");
    }
    await deps.store.takeDown(id, { at: new Date(now()).toISOString(), reason });
    return json(200, { ok: true, id });
  };

  return async (req) => {
    try {
      const method = req.method.toUpperCase();
      const api = /^(.*)\/share-api(\/.*)$/.exec(req.path);
      if (api) {
        const rest = api[2]!;
        if (rest === "/health" && method === "GET") return json(200, { ok: true });
        if (rest === "/shares" && method === "POST") return await create(req);
        const admin = /^\/admin\/shares\/([^/]+)$/.exec(rest);
        if (admin && ID_RE.test(admin[1]!) && method === "DELETE") return await takeDown(req, admin[1]!);
        const one = /^\/shares\/([^/]+)(\/payload)?$/.exec(rest);
        if (one && ID_RE.test(one[1]!)) {
          if (one[2] && method === "GET") {
            const tooMany = over(req, "payloadsPerDay");
            if (tooMany) return tooMany;
            if (await deps.store.takenDown(one[1]!)) return refused(410, "taken-down", TAKEN_DOWN);
            const bytes = await deps.store.payload(one[1]!);
            return bytes
              ? { status: 200, headers: { "content-type": "application/octet-stream", "cache-control": "no-cache", "x-robots-tag": "noindex" }, body: bytes }
              : json(404, { ok: false });
          }
          if (!one[2] && method === "DELETE") return await remove(req, one[1]!);
        }
        return json(404, { ok: false });
      }
      const link = /^(.*)\/s\/([^/]+)(?:\/(preview\.(?:jpg|png)))?\/?$/.exec(req.path);
      if (link && ID_RE.test(link[2]!) && (method === "GET" || method === "HEAD")) {
        const tooMany = over(req, "pagesPerDay");
        if (tooMany) return tooMany;
        if (!link[3]) return await page(req, link[1]!, link[2]!);
        if (await deps.store.takenDown(link[2]!)) {
          return { status: 410, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" }, body: "This link was taken down." };
        }
        const share = await deps.store.get(link[2]!);
        const bytes = share?.imageType ? await deps.store.image(link[2]!) : null;
        if (!share?.imageType || !bytes) return { status: 404, headers: { "content-type": "text/plain" }, body: "not found" };
        // An hour, not a day: a picture taken down stops being served from caches that obey this soon after.
        return { status: 200, headers: { "content-type": share.imageType, "cache-control": "public, max-age=3600", "x-robots-tag": "noindex" }, body: bytes };
      }
      return { status: 404, headers: { "content-type": "text/plain" }, body: "not found" };
    } catch (e) {
      deps.onError?.(e);
      return json(500, { ok: false });
    }
  };
}
