// An app package (#253): what travels when an app is shared or installed.
//
//   app.ts | app.tsx     the source — the whole app, as today
//   src/<path>           the app's own modules, imported from the source as `./plan.ts` (#258)
//   files/<path>         files the app ships with; installed into its own folder as `shipped`
//   lock.json            libraries the source imports by URL → their bytes in files/.modules/ (#266)
//   seed.json            first records, `{ entity: [row, …] }`; applied once, on first install
//   manifest.json        `{ format: "potyro-app/1", source, files: [{ path, size }], modules: […], app }`
//                        `app` is what the app declares — name, icon, entities, pages, permissions —
//                        as data (#271): what the Add-an-app card reads instead of running the code
//   chat.json            optional: the Studio conversation that made it, when the author included it
//
// A zip, so one file carries all of it. A bare source is still a package — one with no files and no
// seed — and an export bundle (`potyro-bundle/1`, which carries `app.ts` beside its data) is read as
// one too, so a backup can be installed on a device that never had the app. A bundle carries the
// app's code the same way (#282) — `lock.json`, `files/.modules/`, `src/` — and nothing else of
// `files/`: its data is in its `data.sqlite`, restored by Import.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { libraryLock, LockError, MODULES_DIR, parseLock, type AppLock } from "./app-lock.js";
import { parseDeclaration, type AppDeclaration } from "./app-declaration.js";
import { isBundleFormat } from "./export.js";

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
  /**
   * The app's own modules (#258), by path under `src/`: what `./plan.ts` in the source resolves to.
   * Code, not data — kept apart from `files`, which the app reads at run time.
   */
  modules: PackagedFile[];
  /**
   * The libraries the source imports by URL and what their bytes must hash to (#266). Bytes the
   * package carries are under `files/.modules/`; a library listed here without them is fetched at
   * install, and must then match.
   */
  lock?: AppLock;
  /** First records by entity. Applied once, on first install; never on an update. */
  seed?: Record<string, Array<Record<string, unknown>>>;
  /** What the package was read from, for the record of where an app came from. */
  kind: "package" | "bundle" | "source";
  /**
   * How the app was made — its Studio conversation, when the author chose to include it (#261). Read
   * as plain JSON and nothing more: the shell decides whether it is a conversation at all.
   */
  chat?: unknown;
  /**
   * What the app declares, from the manifest, when whoever packed it wrote that (#271): the card is
   * drawn from this without running the app. Absent in an older package or a bare source.
   */
  declared?: AppDeclaration;
}

export const APP_PACKAGE_FORMAT = "potyro-app/1";
const MANIFEST = "manifest.json";
const SEED = "seed.json";
const CHAT = "chat.json";
const FILES = "files/";
const SRC = "src/";
const LOCK = "lock.json";
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

  let manifest: { format?: string; source?: string; app?: unknown } = {};
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

  const isBundle = isBundleFormat(manifest.format);
  const declared = parseDeclaration(manifest.app);
  const under = (folder: string): PackagedFile[] =>
    names
      .filter((n) => n.startsWith(prefix + folder))
      .map((n) => ({ path: n.slice(prefix.length + folder.length), data: entries[n]! }))
      .filter((f) => f.path !== "");
  // A bundle's files are its data, in data.sqlite; what it carries beside them is the app's code
  // (#282): its libraries' bytes and its own modules, as a package carries them, and their lock.
  const files = isBundle ? under(FILES).filter((f) => f.path.startsWith(MODULES_DIR)) : under(FILES);
  const rawLock = at(LOCK);
  let lock: AppLock | undefined;
  try {
    lock = rawLock ? parseLock(strFromU8(rawLock)) : undefined;
  } catch (e) {
    throw new AppPackageError(e instanceof LockError ? e.message : String(e));
  }
  return {
    source: strFromU8(at(sourceName)!),
    sourceName,
    files,
    modules: under(SRC),
    lock,
    seed: isBundle ? undefined : parseSeed(at(SEED), SEED),
    chat: parseChat(at(CHAT)),
    kind: isBundle ? "bundle" : "package",
    // A declaration that is not one is ignored, not fatal: the card then reads the app itself.
    ...(declared ? { declared } : {}),
  };
}

/** Make a package zip. The inverse of `readAppPackage` for a `potyro-app/1` package. */
export function packAppPackage(
  pkg: Pick<AppPackage, "source" | "sourceName" | "files" | "seed" | "chat"> & Partial<Pick<AppPackage, "modules" | "lock" | "declared">>,
): Uint8Array {
  const modules = pkg.modules ?? [];
  const sourceName = SOURCE_NAMES.includes(pkg.sourceName) ? pkg.sourceName : /x$/.test(pkg.sourceName) ? "app.tsx" : "app.ts";
  const out: Record<string, Uint8Array> = {
    [MANIFEST]: strToU8(
      JSON.stringify(
        {
          format: APP_PACKAGE_FORMAT,
          source: sourceName,
          files: pkg.files.map((f) => ({ path: f.path, size: f.data.byteLength })),
          ...(modules.length ? { modules: modules.map((m) => ({ path: m.path, size: m.data.byteLength })) } : {}),
          ...(pkg.declared ? { app: pkg.declared } : {}),
        },
        null,
        2,
      ),
    ),
    [sourceName]: strToU8(pkg.source),
  };
  for (const f of pkg.files) out[FILES + f.path] = f.data;
  for (const m of modules) out[SRC + m.path] = m.data;
  const libraries = pkg.lock ? libraryLock(pkg.lock) : {};
  if (Object.keys(libraries).length) out[LOCK] = strToU8(JSON.stringify(libraries, null, 2));
  if (pkg.seed) out[SEED] = strToU8(JSON.stringify(pkg.seed, null, 2));
  if (pkg.chat !== undefined) out[CHAT] = strToU8(JSON.stringify(pkg.chat, null, 2));
  return zipSync(out);
}

/** A bare source as a package. */
export function sourcePackage(source: string, sourceName = "app.tsx"): AppPackage {
  return { source, sourceName, files: [], modules: [], kind: "source" };
}
