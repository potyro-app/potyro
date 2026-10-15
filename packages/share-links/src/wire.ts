// What a demo link's sharer sends the share service, and what both sides check (docs/24 §2, §4).
//
// Browser-safe: the shell imports this to build and read hosted links; the service imports it to
// check what it is sent. No Potyro package, no Node module.
//
// The package itself is sealed here, on the sharer's device, with a fresh key that goes in the link's
// fragment and never to the service: AES-GCM, 128-bit key, a 12-byte IV in front of the ciphertext.
// What the service can read is exactly what a link preview shows — a title, a line of description,
// a language and a picture — and the sharer's device made those from the app's name and its demo
// records, never from anyone's data.

export const LIMITS = {
  /** The sealed package. */
  payloadBytes: 2 * 1024 * 1024,
  /** The preview picture: WhatsApp's practical ceiling for a link preview. */
  imageBytes: 300 * 1024,
  title: 80,
  description: 200,
  /** The whole request: the two above as base64, plus the JSON around them. */
  requestBytes: Math.ceil(((2 * 1024 * 1024 + 300 * 1024) * 4) / 3) + 16 * 1024,
} as const;

/** Share ids: 128 random bits, base64url. */
export const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export interface ShareMeta {
  title: string;
  description: string;
  /** BCP 47, the sharer's language: what the title and description are written in. */
  lang: string;
}

export type ImageType = "image/jpeg" | "image/png";

/** What the shell POSTs to `/share-api/shares`. */
export interface ShareUpload {
  meta: ShareMeta;
  /** base64 */
  payload: string;
  /** base64; optional — a link without a picture still gets a title. */
  image?: string;
}

export interface ShareCreated {
  id: string;
  /** Proves the sender is the one asking to take it down. Kept on their device only. */
  deleteToken: string;
}

/** Text a preview may show: one line, no control characters, trimmed, capped. */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** The meta as sent, checked. Throws a short reason when it is not usable. */
export function readMeta(raw: unknown): ShareMeta {
  if (!raw || typeof raw !== "object") throw new Error("meta missing");
  const m = raw as Record<string, unknown>;
  const title = cleanText(m.title, LIMITS.title);
  if (!title) throw new Error("title missing");
  const lang = typeof m.lang === "string" && LANG_RE.test(m.lang) ? m.lang : "en";
  return { title, description: cleanText(m.description, LIMITS.description), lang };
}

/** What a picture's first bytes say it is. Only JPEG and PNG are served. */
export function imageTypeOf(bytes: Uint8Array): ImageType | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  return null;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const b64url = (bytes: Uint8Array): string => toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text: string): Uint8Array => {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return fromBase64(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
};

/** A fresh share id. */
export function newShareId(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

const IV_BYTES = 12;

/** Whether this page can seal and open packages: WebCrypto exists only in a secure context. */
export function canSeal(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.subtle?.encrypt === "function";
}

/** Seal a package for the service. The key is for the link's fragment, never for the service. */
export async function sealPackage(zip: Uint8Array): Promise<{ key: string; sealed: Uint8Array }> {
  const raw = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, zip as BufferSource));
  const sealed = new Uint8Array(IV_BYTES + cipher.length);
  sealed.set(iv);
  sealed.set(cipher, IV_BYTES);
  return { key: b64url(raw), sealed };
}

/** Open a sealed package with the key from the link. Throws when the key is not this package's. */
export async function openPackage(sealed: Uint8Array, keyText: string): Promise<Uint8Array> {
  const raw = fromB64url(keyText);
  if (raw.length !== 16 || sealed.length <= IV_BYTES) throw new Error("not a sealed package");
  const key = await crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.subarray(0, IV_BYTES) as BufferSource }, key, sealed.subarray(IV_BYTES) as BufferSource);
  return new Uint8Array(plain);
}
