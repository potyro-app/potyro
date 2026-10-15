// The share service (docs/24 §4), as a function from a request to a response: the HTTP server
// (server.ts) and the dev server's middleware (the shell's vite.config.ts) both call it.
//
//   GET    /share-api/health                → { ok: true }
//   POST   /share-api/shares                → { ok, id, deleteToken }      (a ShareUpload)
//   GET    /share-api/shares/<id>/payload   → the sealed package
//   DELETE /share-api/shares/<id>           → with `x-delete-token`: gone
//   GET    /s/<id>                          → the shell's page, with the link's preview meta
//   GET    /s/<id>/preview.jpg|.png         → the preview picture
//
// It never runs app code and cannot read a package: what it can read is what a preview shows.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sharePage } from "./page.ts";
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

export interface Limits {
  /** Shares one address may make in a window. */
  perAddress: number;
  windowMs: number;
}

export const DEFAULT_LIMITS: Limits = { perAddress: 30, windowMs: 24 * 60 * 60 * 1000 };

export interface HandlerDeps {
  store: ShareStore;
  /** The shell's index.html, as built: the page every link answers with. Read per request, so a deploy shows at once. */
  indexHtml: (path: string) => Promise<string>;
  /** `https://apps.example` — what preview URLs are built on. Else the request's own host. */
  publicOrigin?: string;
  now?: () => number;
  limits?: Limits;
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

function limiter(windowMs: number, now: () => number) {
  const seen = new Map<string, number[]>();
  return (key: string, max: number): boolean => {
    const t = now();
    const recent = (seen.get(key) ?? []).filter((at) => t - at < windowMs);
    if (recent.length >= max) {
      seen.set(key, recent);
      return false;
    }
    recent.push(t);
    seen.set(key, recent);
    return true;
  };
}

export function createShareHandler(deps: HandlerDeps): (req: ShareRequest) => Promise<ShareResponse> {
  const now = deps.now ?? Date.now;
  const limits = deps.limits ?? DEFAULT_LIMITS;
  const allow = limiter(limits.windowMs, now);

  const originOf = (req: ShareRequest): string => {
    if (deps.publicOrigin) return deps.publicOrigin.replace(/\/+$/, "");
    const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
    const proto = req.headers["x-forwarded-proto"] ?? "http";
    return `${proto}://${host}`;
  };

  const page = async (req: ShareRequest, prefix: string, id: string): Promise<ShareResponse> => {
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
    if (!allow(req.ip, limits.perAddress)) return json(429, { ok: false, error: "too many shares from here today" });
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
    const share = await deps.store.get(id);
    if (!share) return json(404, { ok: false });
    const given = Buffer.from(sha256(req.headers["x-delete-token"] ?? ""), "hex");
    const kept = Buffer.from(share.deleteHash, "hex");
    if (given.length !== kept.length || !timingSafeEqual(given, kept)) return json(403, { ok: false });
    await deps.store.remove(id);
    return json(200, { ok: true });
  };

  return async (req) => {
    try {
      const method = req.method.toUpperCase();
      const api = /^(.*)\/share-api(\/.*)$/.exec(req.path);
      if (api) {
        const rest = api[2]!;
        if (rest === "/health" && method === "GET") return json(200, { ok: true });
        if (rest === "/shares" && method === "POST") return await create(req);
        const one = /^\/shares\/([^/]+)(\/payload)?$/.exec(rest);
        if (one && ID_RE.test(one[1]!)) {
          if (one[2] && method === "GET") {
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
        if (!link[3]) return await page(req, link[1]!, link[2]!);
        const share = await deps.store.get(link[2]!);
        const bytes = share?.imageType ? await deps.store.image(link[2]!) : null;
        if (!share?.imageType || !bytes) return { status: 404, headers: { "content-type": "text/plain" }, body: "not found" };
        return { status: 200, headers: { "content-type": share.imageType, "cache-control": "public, max-age=86400", "x-robots-tag": "noindex" }, body: bytes };
      }
      return { status: 404, headers: { "content-type": "text/plain" }, body: "not found" };
    } catch (e) {
      deps.onError?.(e);
      return json(500, { ok: false });
    }
  };
}
