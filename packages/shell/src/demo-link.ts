// Demo links (docs/24 §2): a link that opens an app running, sealed, with demo records.
//
// Inline form: `<site>/#try=<package>` — the demo package (a zip), base64url, in the fragment. A
// fragment never reaches a server, so it works on any static deployment; it is the fallback for when
// the share service (hosted form, `/s/<id>#k=<key>`) is not there.

/** The fragment key of an inline demo link. */
export const INLINE_KEY = "try";

/**
 * The longest inline link made. Past it some messengers cut the link (Telegram stops at 4096
 * characters a message) and some browsers' address bars get slow; the hosted form has no such limit.
 */
export const MAX_INLINE_CHARS = 24_000;

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Where the site is served from: the path before a demo link's `/s/<id>`, always ending in `/`. */
export function siteBase(pathname: string): string {
  const base = pathname.replace(/s\/[^/]+\/?$/, "");
  return base.endsWith("/") ? base : `${base}/`;
}

/** An inline demo link for a package, or null when it would be too long to send as one. */
export function inlineDemoLink(zip: Uint8Array, origin: string, pathname: string): string | null {
  const link = `${origin}${siteBase(pathname)}#${INLINE_KEY}=${toBase64Url(zip)}`;
  return link.length > MAX_INLINE_CHARS ? null : link;
}

/**
 * The remix intent (docs/24 §6): `#k=<key>&remix=1` (or `#try=<package>&remix=1`) opens the demo with
 * "Make it mine" already asked — the gallery's second button. Only `1` means it; anything else is a
 * plain demo. It is in the fragment like the key, so it never reaches a server either.
 */
export const REMIX_KEY = "remix";

/** A demo link, as the address bar has it. `remix`: the link asks to make it the person's own. */
export type DemoLink = ({ kind: "inline"; zip: Uint8Array } | { kind: "hosted"; id: string; key: string }) & { remix?: true };

/** The same demo link, asking to make it the person's own: what the gallery's "Make it mine" opens. */
export function remixLink(link: string): string {
  const at = link.indexOf("#");
  if (at < 0) throw new Error("A demo link carries its key or package in the fragment");
  const params = new URLSearchParams(link.slice(at + 1));
  if (params.get(REMIX_KEY) === "1") return link;
  return `${link}&${REMIX_KEY}=1`;
}

/** Share ids are 128 random bits, base64url: 22 characters. */
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * The demo link in a URL, if it is one. Takes the pieces rather than `location` so a link that
 * arrived as an OS event (a device) reads the same way.
 */
export function readDemoLink(pathname: string, hash: string): DemoLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const remix = params.get(REMIX_KEY) === "1" ? ({ remix: true } as const) : {};
  const inline = params.get(INLINE_KEY);
  if (inline) {
    try {
      return { kind: "inline", zip: fromBase64Url(inline), ...remix };
    } catch {
      return null;
    }
  }
  const hosted = /\/s\/([^/]+)\/?$/.exec(pathname);
  const key = params.get("k");
  if (hosted && key && ID_RE.test(hosted[1]!)) return { kind: "hosted", id: hosted[1]!, key, ...remix };
  return null;
}
