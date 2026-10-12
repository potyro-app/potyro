// An app package (#253): what travels when an app is shared or installed.
//
//   app.ts | app.tsx     the source — the whole app, as today
//   files/<path>         files the app ships with; installed into its own folder as `shipped`
//   seed.json            first records, `{ entity: [row, …] }`; applied once, on first install
//   manifest.json        `{ format: "potyro-app/1", source, files: [{ path, size }] }`
//   chat.json            optional: the Studio conversation that made it, when the author included it
//
// A zip, so one file carries all of it. A bare source is still a package — one with no files and no
// seed — and an export bundle (`potyro-bundle/1`, which carries `app.ts` beside its data) is read as
// one too, so a backup can be installed on a device that never had the app.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export interface PackagedFile {
  path: string;
  data: Uint8Array;
  mime?: string;
}

export interface AppPackage {
  source: string;
  /** What the source file was called (`app.tsx`, `piano.app.tsx`): decides JSX or not on bundling. */
  sourceName: string;
  files: PackagedFile[];
  /** First records by entity. Applied once, on first install; never on an update. */
  seed?: Record<string, Array<Record<string, unknown>>>;
  /** What the package was read from, for the record of where an app came from. */
  kind: "package" | "bundle" | "source";
  /**
   * How the app was made — its Studio conversation, when the author chose to include it (#261). Read
   * as plain JSON and nothing more: the shell decides whether it is a conversation at all.
   */
  chat?: unknown;
}

export const APP_PACKAGE_FORMAT = "potyro-app/1";
const MANIFEST = "manifest.json";
const SEED = "seed.json";
const CHAT = "chat.json";
const FILES = "files/";
const SOURCE_NAMES = ["app.tsx", "app.ts", "app.jsx", "app.js"];

export class AppPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppPackageError";
  }
}

/** A zip starts with "PK\x03\x04" (or "PK\x05\x06" when it is empty). */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5);
}

function parseSeed(raw: Uint8Array | undefined, where: string): AppPackage["seed"] {
  if (!raw) return undefined;
  let seed: unknown;
  try {
    seed = JSON.parse(strFromU8(raw));
  } catch (e) {
    throw new AppPackageError(`${where} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!seed || typeof seed !== "object" || Array.isArray(seed)) throw new AppPackageError(`${where} must be { entity: [records] }`);
  for (const [entity, rows] of Object.entries(seed)) {
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== "object" || Array.isArray(r))) {
      throw new AppPackageError(`${where}: "${entity}" must be a list of records`);
    }
  }
  return seed as AppPackage["seed"];
}

/**
 * A conversation that does not parse is dropped, not fatal: it is about the app, and the app is what
 * the person asked to add.
 */
function parseChat(raw: Uint8Array | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(strFromU8(raw)) as unknown;
  } catch {
    return undefined;
  }
}

/** Read a package or an export bundle from zip bytes. */
export function readAppPackage(bytes: Uint8Array): AppPackage {
  if (!isZip(bytes)) throw new AppPackageError("Not a zip file");
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (e) {
    throw new AppPackageError(`The zip could not be opened: ${e instanceof Error ? e.message : String(e)}`);
  }
  // A zip made by hand often wraps everything in one folder ("piano/app.tsx"). Read through it.
  const names = Object.keys(entries).filter((n) => !n.endsWith("/"));
  const roots = new Set(names.map((n) => n.split("/")[0]));
  const prefix = roots.size === 1 && names.every((n) => n.includes("/")) ? `${[...roots][0]}/` : "";
  const at = (name: string): Uint8Array | undefined => entries[prefix + name];

  let manifest: { format?: string; source?: string } = {};
  const rawManifest = at(MANIFEST);
  if (rawManifest) {
    try {
      manifest = JSON.parse(strFromU8(rawManifest));
    } catch {
      throw new AppPackageError("manifest.json is not valid JSON");
    }
  }
  const sourceName =
    (manifest.source && at(manifest.source) ? manifest.source : undefined) ??
    SOURCE_NAMES.find((n) => at(n)) ??
    names.map((n) => n.slice(prefix.length)).find((n) => !n.includes("/") && /\.app\.[jt]sx?$/.test(n));
  if (!sourceName) throw new AppPackageError("No app source in the zip (expected app.ts or app.tsx)");

  const isBundle = manifest.format === "potyro-bundle/1";
  const files: PackagedFile[] = isBundle
    ? []
    : names
        .filter((n) => n.startsWith(prefix + FILES))
        .map((n) => ({ path: n.slice(prefix.length + FILES.length), data: entries[n]! }))
        .filter((f) => f.path !== "");
  return {
    source: strFromU8(at(sourceName)!),
    sourceName,
    files,
    seed: isBundle ? undefined : parseSeed(at(SEED), SEED),
    chat: parseChat(at(CHAT)),
    kind: isBundle ? "bundle" : "package",
  };
}

/** Make a package zip. The inverse of `readAppPackage` for a `potyro-app/1` package. */
export function packAppPackage(pkg: Pick<AppPackage, "source" | "sourceName" | "files" | "seed" | "chat">): Uint8Array {
  const sourceName = SOURCE_NAMES.includes(pkg.sourceName) ? pkg.sourceName : /x$/.test(pkg.sourceName) ? "app.tsx" : "app.ts";
  const out: Record<string, Uint8Array> = {
    [MANIFEST]: strToU8(
      JSON.stringify(
        { format: APP_PACKAGE_FORMAT, source: sourceName, files: pkg.files.map((f) => ({ path: f.path, size: f.data.byteLength })) },
        null,
        2,
      ),
    ),
    [sourceName]: strToU8(pkg.source),
  };
  for (const f of pkg.files) out[FILES + f.path] = f.data;
  if (pkg.seed) out[SEED] = strToU8(JSON.stringify(pkg.seed, null, 2));
  if (pkg.chat !== undefined) out[CHAT] = strToU8(JSON.stringify(pkg.chat, null, 2));
  return zipSync(out);
}

/** A bare source as a package. */
export function sourcePackage(source: string, sourceName = "app.tsx"): AppPackage {
  return { source, sourceName, files: [], kind: "source" };
}
