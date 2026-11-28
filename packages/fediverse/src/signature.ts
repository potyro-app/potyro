// HTTP signatures as the fediverse uses them (draft-cavage-http-signatures-12, rsa-sha256): every
// activity this service sends is signed with the account's key, and every activity it acts on
// must be signed by the key of the account it says it is from.
//
// What a signature must cover to be believed here: the request line, the host, the date and (for a
// POST) the digest of the body. One that leaves any of them out could be replayed against another
// address or carry another body, so it is refused.
import { createHash, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";

/** How far a request's date may be from this server's clock. */
export const CLOCK_WINDOW_MS = 60 * 60 * 1000;
const MIN_RSA_BITS = 2048;

export const digestOf = (body: Uint8Array): string => `SHA-256=${createHash("sha256").update(body).digest("base64")}`;

type Headers = Record<string, string | undefined>;

/** The text that is signed: one line per covered header, in the order the signature names them. */
function signingString(names: readonly string[], method: string, target: string, headers: Headers): string | null {
  const lines: string[] = [];
  for (const name of names) {
    if (name === "(request-target)") {
      lines.push(`(request-target): ${method.toLowerCase()} ${target}`);
      continue;
    }
    const value = Object.hasOwn(headers, name) ? headers[name] : undefined;
    if (typeof value !== "string") return null;
    lines.push(`${name}: ${value.trim()}`);
  }
  return lines.join("\n");
}

export interface ToSign {
  method: "GET" | "POST";
  url: URL;
  /** A POST's body; a GET has none. */
  body?: Uint8Array;
  keyId: string;
  privateKeyPem: string;
  now: Date;
}

/** The headers of a signed request: host, date, the digest of a body, and the signature over them. */
export function signedHeaders(p: ToSign): Record<string, string> {
  const headers: Record<string, string> = { host: p.url.host, date: p.now.toUTCString() };
  const names = ["(request-target)", "host", "date"];
  if (p.body) {
    headers.digest = digestOf(p.body);
    headers["content-type"] = "application/activity+json";
    names.push("digest", "content-type");
  }
  const text = signingString(names, p.method, p.url.pathname + p.url.search, headers);
  if (text === null) throw new Error("a signed header is missing");
  const signature = cryptoSign("RSA-SHA256", Buffer.from(text), p.privateKeyPem).toString("base64");
  return { ...headers, signature: `keyId="${p.keyId}",algorithm="rsa-sha256",headers="${names.join(" ")}",signature="${signature}"` };
}

export interface ParsedSignature {
  keyId: string;
  algorithm: string;
  headers: string[];
  signature: string;
}

/** The parts of a `Signature` header, or null when it is not one. */
export function parseSignature(header: string | undefined): ParsedSignature | null {
  if (!header || header.length > 4000) return null;
  const parts: Record<string, string> = {};
  for (const m of header.matchAll(/([a-zA-Z]+)="([^"]*)"/g)) parts[m[1]!.toLowerCase()] = m[2]!;
  const { keyid, signature } = parts;
  if (!keyid || !signature) return null;
  const headers = (parts.headers ?? "date").toLowerCase().split(/\s+/).filter(Boolean);
  return { keyId: keyid, algorithm: (parts.algorithm ?? "rsa-sha256").toLowerCase(), headers, signature };
}

export interface ToVerify {
  method: string;
  /** The path and query as they were asked for. */
  target: string;
  headers: Headers;
  body: Uint8Array;
  signature: ParsedSignature;
  publicKeyPem: string;
  /** The host this service answers as: a signature made for another host is not for us. */
  host: string;
  now: number;
}

export type Verdict = { ok: true } | { ok: false; why: string };

const no = (why: string): Verdict => ({ ok: false, why });

/** Whether a PEM is an RSA public key long enough to believe. */
export function isStrongRsaKey(pem: string): boolean {
  try {
    const key = createPublicKey(pem);
    return key.asymmetricKeyType === "rsa" && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= MIN_RSA_BITS;
  } catch {
    return false;
  }
}

/** Whether a request was signed by the holder of `publicKeyPem`, for this host, now, with this body. */
export function verifyRequest(p: ToVerify): Verdict {
  const { signature } = p;
  // `hs2019` is what newer senders call the same rsa-sha256 signature.
  if (signature.algorithm !== "rsa-sha256" && signature.algorithm !== "hs2019") return no("an algorithm this service does not read");
  const needed = p.method.toUpperCase() === "POST" ? ["(request-target)", "host", "date", "digest"] : ["(request-target)", "host", "date"];
  for (const name of needed) if (!signature.headers.includes(name)) return no(`the signature does not cover ${name}`);
  if ((p.headers.host ?? "").trim().toLowerCase() !== p.host.toLowerCase()) return no("signed for another host");
  const date = Date.parse(p.headers.date ?? "");
  if (Number.isNaN(date) || Math.abs(p.now - date) > CLOCK_WINDOW_MS) return no("the date is too far from now");
  if (needed.includes("digest")) {
    const sent = (p.headers.digest ?? "").trim();
    const want = digestOf(p.body);
    if (sent.slice(0, 8).toUpperCase() !== "SHA-256=" || sent.slice(8) !== want.slice(8)) return no("the digest is not the body's");
  }
  if (!isStrongRsaKey(p.publicKeyPem)) return no("not an RSA key of 2048 bits or more");
  const text = signingString(signature.headers, p.method, p.target, p.headers);
  if (text === null) return no("a signed header is missing");
  let good = false;
  try {
    good = cryptoVerify("RSA-SHA256", Buffer.from(text), p.publicKeyPem, Buffer.from(signature.signature, "base64"));
  } catch {
    good = false;
  }
  return good ? { ok: true } : no("the signature does not match");
}
