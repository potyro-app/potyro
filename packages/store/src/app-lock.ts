// What an app's code is made of beyond its one source file (#266, #258), and how a device knows the
// bytes it runs are the ones the app was installed with.
//
//   https://esm.sh/chart.js@4.4.1?bundle   a library, imported by URL and pinned to an exact version.
//                                          Its bytes, and every file they import, are fetched ONCE
//                                          (at install, with consent) into `.modules/<sha256>.js`.
//   ./plan.ts                              one of the package's own modules, from its `src/` folder,
//                                          kept in `.src/plan.ts`.
//
// The lock maps each of those to the file that holds it and the digest of its bytes. It is what the
// bundler trusts: a file whose bytes no longer match is refused, by name, rather than run. Both
// folders live in the app's own file space so they travel with it (install, update, sync), and both
// are kept away from `ctx.files` — they are the app's code, not its data.
//
// Nothing here fetches. Fetching is the shell's, at install, never at run time (CLAUDE.md rule 6).

/** Where library bytes live in an app's file space. */
export const MODULES_DIR = ".modules/";
/** Where a package's own modules live in an app's file space. */
export const SRC_DIR = ".src/";

export interface LockEntry {
  /** The file in the app's space: `.modules/<sha256>.js` for a library, `.src/<path>` for a module. */
  file: string;
  /** `sha256-<base64>`, as in Subresource Integrity. */
  integrity: string;
  size: number;
  /**
   * The URL the bytes were really served from, when the host redirected. A library's own imports
   * (`/chart.js@4.4.1/es2022/chart.bundle.mjs`) are resolved against it, as the browser would.
   */
  base?: string;
}

/**
 * URL → entry for libraries; `src/<path>` → entry for the package's own modules. One map, so one
 * check covers every byte of code the app runs apart from its entry file.
 */
export type AppLock = Record<string, LockEntry>;

/** The lock key of one of the package's own modules. */
export const srcKey = (path: string): string => `src/${path}`;

export class LockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockError";
  }
}

/** True for the folders that hold the app's code, which the app itself must not see or change. */
export function isReservedPath(path: string): boolean {
  const p = path.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "");
  return p.startsWith(MODULES_DIR) || p.startsWith(SRC_DIR);
}

// ---- digests -------------------------------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * SHA-256 in plain JavaScript. `crypto.subtle` exists only in a secure context, and the shell is
 * sometimes served over plain http on a LAN; an integrity check that quietly became something weaker
 * there would not be one. `file-space.ts`'s `digest` may fall back to FNV — it only tells changed
 * from unchanged. This has to stop a swapped library, so it is always SHA-256.
 */
function sha256Js(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const bitLen = data.length * 8;
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]!);
  return out;
}

async function sha256(data: Uint8Array, opts: { platform?: boolean } = {}): Promise<Uint8Array> {
  const subtle = opts.platform === false ? undefined : (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (subtle) return new Uint8Array(await subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>));
  return sha256Js(data);
}

const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function toBase64(b: Uint8Array): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += abc[(n >> 18) & 63]! + abc[(n >> 12) & 63]! + (i + 1 < b.length ? abc[(n >> 6) & 63]! : "=") + (i + 2 < b.length ? abc[n & 63]! : "=");
  }
  return out;
}

/** Hex SHA-256. `platform: false` forces the plain-JS digest (tests, and contexts without `subtle`). */
export async function sha256Hex(data: Uint8Array, opts: { platform?: boolean } = {}): Promise<string> {
  return toHex(await sha256(data, opts));
}

/** `sha256-<base64>`. */
export async function integrityOf(data: Uint8Array): Promise<string> {
  return `sha256-${toBase64(await sha256(data))}`;
}

/** Where a library's bytes are kept: named by their digest, so two apps' copies never collide. */
export async function moduleFileFor(data: Uint8Array): Promise<string> {
  return `${MODULES_DIR}${await sha256Hex(data)}.js`;
}

/** A lock entry for bytes about to be kept at `file`. */
export async function lockEntryFor(file: string, data: Uint8Array, base?: string): Promise<LockEntry> {
  return { file, integrity: await integrityOf(data), size: data.byteLength, ...(base ? { base } : {}) };
}

/** Whether `data` is what `entry` promised. */
export async function matchesLock(entry: LockEntry, data: Uint8Array): Promise<boolean> {
  return data.byteLength === entry.size && (await integrityOf(data)) === entry.integrity;
}

// ---- library URLs --------------------------------------------------------------------------------

/** `name@version` at the start of a URL's path: `chart.js@4.4.1`, `@kurkle/color@0.3.2`. */
const NAME_AT_VERSION = /^\/(?:v\d+\/)?((?:@[^/@]+\/)?[^/@]+)@([^/?#]+)/;
/** An exact semver: no ranges, tags or partial versions. */
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function parsed(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** "chart.js 4.4.1", for every message a person reads about a library. */
export function libraryLabel(url: string): string {
  const u = parsed(url);
  if (!u) return url;
  const m = NAME_AT_VERSION.exec(u.pathname);
  return m ? `${decodeURIComponent(m[1]!)} ${decodeURIComponent(m[2]!)}` : `${u.host}${u.pathname}`;
}

/** "esm.sh". */
export function libraryHost(url: string): string {
  return parsed(url)?.host ?? url;
}

/**
 * Whether a URL names one exact version. A URL without one is a moving target: the same import
 * could mean different code tomorrow, which no lock can make honest.
 */
export function isPinned(url: string): boolean {
  const u = parsed(url);
  if (!u) return false;
  const m = NAME_AT_VERSION.exec(u.pathname);
  return !!m && EXACT.test(decodeURIComponent(m[2]!));
}

// ---- imports in a source -------------------------------------------------------------------------

/**
 * Every module specifier a source imports, in order: static imports, `export … from`, and
 * `import("…")` with a literal. A small scanner rather than a regex over the text, so an import
 * written in a comment or inside a string is not mistaken for one. It reads code, it does not run it.
 */
export function importsOf(source: string): string[] {
  const out: string[] = [];
  let code = ""; // the code read so far, without comments or string contents: the context of a literal
  let i = 0;
  const n = source.length;
  const regexMayStart = () => /(^|[(,=:[!&|?{};+\-*%<>~^]|\breturn|\btypeof|\bcase|\bdo|\belse|\bin|\bof)\s*$/.test(code);
  while (i < n) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      let value = "";
      while (j < n && source[j] !== c) {
        if (source[j] === "\\") {
          value += source[j + 1] ?? "";
          j += 2;
          continue;
        }
        value += source[j];
        j++;
      }
      if (c !== "`" && /(\bfrom|\bimport|\bimport\s*\()\s*$/.test(code)) out.push(value);
      code += " _ ";
      i = j + 1;
      continue;
    }
    if (c === "/" && regexMayStart()) {
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== "\n") {
        const d = source[j];
        if (d === "\\") j++;
        else if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) break;
        j++;
      }
      code += " _ ";
      i = j + 1;
      continue;
    }
    code += c;
    if (code.length > 64) code = code.slice(-32);
    i++;
  }
  return out;
}

/** The libraries a source imports by URL, in order, without repeats. */
export function urlImportsOf(source: string): string[] {
  return [...new Set(importsOf(source).filter((s) => /^https?:\/\//i.test(s)))];
}

/** The package modules a source imports (`./plan.js`, `../shared/x.ts`), in order, without repeats. */
export function relativeImportsOf(source: string): string[] {
  return [...new Set(importsOf(source).filter((s) => /^\.\.?\//.test(s)))];
}

// ---- lock.json -----------------------------------------------------------------------------------

const MODULE_FILE = /^\.modules\/[0-9a-f]{64}\.js$/;

/**
 * Read a package's `lock.json`. Only libraries are listed there — a package's own modules are right
 * beside it in `src/` — and every entry must point into `.modules/`, so a lock can never name one of
 * the app's data files as code.
 */
export function parseLock(text: string): AppLock {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new LockError(`lock.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new LockError("lock.json must map each library's URL to its file");
  const lock: AppLock = {};
  for (const [url, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^https:\/\//.test(url)) throw new LockError(`lock.json: "${url}" is not an https URL`);
    const e = v as Partial<LockEntry> | null;
    if (!e || typeof e !== "object") throw new LockError(`lock.json: "${url}" has no entry`);
    if (typeof e.file !== "string" || !MODULE_FILE.test(e.file)) throw new LockError(`lock.json: "${url}" must point to a file in .modules/`);
    if (typeof e.integrity !== "string" || !/^sha256-[A-Za-z0-9+/]+=*$/.test(e.integrity)) throw new LockError(`lock.json: "${url}" needs a sha256 integrity`);
    if (typeof e.size !== "number" || !Number.isInteger(e.size) || e.size < 0) throw new LockError(`lock.json: "${url}" needs a size`);
    if (e.base !== undefined && (typeof e.base !== "string" || !/^https:\/\//.test(e.base))) throw new LockError(`lock.json: "${url}" has a base that is not an https URL`);
    lock[url] = { file: e.file, integrity: e.integrity, size: e.size, ...(e.base ? { base: e.base } : {}) };
  }
  return lock;
}

/** The libraries part of a lock, as `lock.json` holds it. */
export function libraryLock(lock: AppLock): AppLock {
  return Object.fromEntries(Object.entries(lock).filter(([k]) => /^https?:\/\//.test(k)));
}
