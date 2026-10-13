// What a package's code needs beyond its source, for Add an app (#266, #258): which libraries it
// imports and whether their bytes came with it, and — at install — the lock and the files that make
// it runnable offline.
//
// The card is told before anything is fetched: "fetches chart.js 4.4.1 from esm.sh". The fetch is
// the person's to allow, and happens when they add the app; a package that already carries the bytes
// fetches nothing. Either way every byte is checked against the lock before it is kept.
import {
  libraryHost,
  libraryLabel,
  lockEntryFor,
  matchesLock,
  MODULES_DIR,
  SRC_DIR,
  srcKey,
  urlImportsOf,
  type AppLock,
  type AppPackage,
  type PackagedFile,
} from "@potyro/store";
import { getEsbuild, type EsbuildLike } from "./app-bundler.js";
import { browserGet, fetchLibraries, unusableLibraryUrl, type HttpGet } from "./library-fetch.js";
import { memoryModules, type ModuleSource } from "./package-modules.js";

export interface LibraryLine {
  url: string;
  /** "chart.js 4.4.1" */
  label: string;
  /** "esm.sh" */
  host: string;
  /** Every file it needs came with the package, and matches: nothing to fetch. */
  here: boolean;
  /** Bytes of it and everything it imports, when known. */
  size?: number;
}

export interface PackageDeps {
  esbuild?: EsbuildLike;
  /** The network, for the fetch the person allowed. Injected in tests. */
  get?: HttpGet;
}

const decoder = new TextDecoder();

/** The library URLs a package's code imports: its source's and its modules'. */
export function libraryUrlsOf(pkg: Pick<AppPackage, "source" | "modules">): string[] {
  const all = [pkg.source, ...pkg.modules.filter((m) => /\.[cm]?[jt]sx?$/.test(m.path)).map((m) => decoder.decode(m.data))];
  return [...new Set(all.flatMap(urlImportsOf))];
}

/** The lock entries and files for the package's own modules, kept under `.src/`. */
export async function moduleFiles(modules: PackagedFile[]): Promise<{ lock: AppLock; files: PackagedFile[] }> {
  const lock: AppLock = {};
  const files: PackagedFile[] = [];
  for (const m of modules) {
    const file = SRC_DIR + m.path;
    lock[srcKey(m.path)] = await lockEntryFor(file, m.data);
    files.push({ path: file, data: m.data, mime: "text/plain" });
  }
  return { lock, files };
}

/** Everything the package's code can be read from right now, without the network. */
async function packageModules(pkg: AppPackage): Promise<ModuleSource> {
  const own = await moduleFiles(pkg.modules);
  const files = new Map<string, Uint8Array>();
  for (const f of [...pkg.files, ...own.files]) files.set(f.path, f.data);
  return memoryModules({ ...(pkg.lock ?? {}), ...own.lock }, files);
}

/** A network that is not there: what tells "came with the package" from "has to be fetched". */
const offline: HttpGet = async (url) => {
  throw new Error(`${url} is not in the package`);
};

/**
 * Code the package carries that is not what its lock says, by name (#282). A file changed after it
 * was locked — in a backup, a package passed around — is refused, never fetched again in its place
 * and never run: the person hears which library or file it was, and nothing is added.
 */
export async function carriedCodeIssues(pkg: Pick<AppPackage, "lock" | "files" | "modules">): Promise<string[]> {
  const carried = new Map<string, Uint8Array>();
  for (const f of pkg.files) if (f.path.startsWith(MODULES_DIR)) carried.set(f.path, f.data);
  for (const m of pkg.modules) carried.set(SRC_DIR + m.path, m.data);
  const issues = new Set<string>();
  for (const [key, entry] of Object.entries(pkg.lock ?? {})) {
    const bytes = carried.get(entry.file);
    if (!bytes || (await matchesLock(entry, bytes))) continue;
    const what = key.startsWith("src/") ? `Its file ${key.slice("src/".length)}` : libraryLabel(key);
    issues.add(`${what} is not the copy this app was saved with, so it was not added.`);
  }
  return [...issues];
}

/** The libraries a package uses, for the card, and the problems with any of them. */
export async function inspectLibraries(pkg: AppPackage, deps: PackageDeps = {}): Promise<{ lines: LibraryLine[]; issues: string[]; modules: ModuleSource }> {
  const modules = await packageModules(pkg);
  const lines: LibraryLine[] = [];
  const issues: string[] = await carriedCodeIssues(pkg);
  const urls = libraryUrlsOf(pkg);
  const esbuild = urls.length ? (deps.esbuild ?? (await getEsbuild())) : undefined;
  for (const url of urls) {
    const why = unusableLibraryUrl(url);
    if (why) {
      issues.push(why);
      continue;
    }
    const line: LibraryLine = { url, label: libraryLabel(url), host: libraryHost(url), here: false, size: pkg.lock?.[url]?.size };
    try {
      const { lock } = await fetchLibraries([url], { esbuild: esbuild!, get: offline, have: modules, pinned: pkg.lock });
      line.here = true;
      line.size = Object.values(lock).reduce((n, e) => n + e.size, 0);
    } catch {
      // Not all of it is here (or what is here does not match): it is fetched when the app is added.
    }
    lines.push(line);
  }
  return { lines, issues, modules };
}

/**
 * Fetch what the package's libraries still need, with the person's consent, and return the package
 * carrying all of it: every file under `files/.modules/`, and a lock naming each one.
 */
export async function fetchPackageLibraries(pkg: AppPackage, deps: PackageDeps = {}): Promise<AppPackage> {
  const urls = libraryUrlsOf(pkg);
  if (!urls.length) return pkg;
  const fetched = await fetchLibraries(urls, {
    esbuild: deps.esbuild ?? (await getEsbuild()),
    get: deps.get ?? browserGet,
    have: await packageModules(pkg),
    pinned: pkg.lock,
  });
  return {
    ...pkg,
    lock: fetched.lock,
    files: [...pkg.files.filter((f) => !f.path.startsWith(MODULES_DIR)), ...fetched.files],
  };
}

/**
 * The code an installed app keeps beside its data, and the lock for its record: the package's
 * libraries (fetched now if they still need to be — the card said so) and its own modules.
 */
export async function prepareCode(pkg: AppPackage, deps: PackageDeps = {}): Promise<{ lock: AppLock; files: PackagedFile[]; pkg: AppPackage }> {
  const ready = await fetchPackageLibraries(pkg, deps);
  const own = await moduleFiles(ready.modules);
  const libraries = libraryUrlsOf(ready).length ? (ready.lock ?? {}) : {};
  return { lock: { ...libraries, ...own.lock }, files: [...ready.files, ...own.files], pkg: ready };
}

/** "190 KB": the size a person reads on the card. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One library, as the Add-an-app card and the Studio say it: "fetches chart.js 4.4.1, 190 KB, from
 * esm.sh" before the fetch, "chart.js 4.4.1, 190 KB, came with the app" when nothing is fetched.
 */
export function describeLibrary(line: Pick<LibraryLine, "label" | "host" | "here" | "size">, opts: { done?: boolean } = {}): string {
  const what = line.size !== undefined ? `${line.label}, ${formatSize(line.size)},` : line.label;
  return line.here ? `${what} came with the app` : `${opts.done ? "fetched" : "fetches"} ${what} from ${line.host}`;
}

/** Each library in a lock as "name" → "version", from every file of it the lock holds. */
function versionsIn(lock: AppLock | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const url of Object.keys(lock ?? {})) {
    if (!/^https?:\/\//.test(url)) continue;
    const label = libraryLabel(url);
    const cut = label.lastIndexOf(" ");
    if (cut > 0) out.set(label.slice(0, cut), label.slice(cut + 1));
  }
  return out;
}

/**
 * What changed in an app's libraries between two locks, for the note on its History version:
 * "chart.js 4.4.1 (was 4.4.0)", "now uses date-fns 3.6.0", "no longer uses tone 14.7.77". Empty when
 * nothing did.
 */
export function libraryChanges(before: AppLock | undefined, after: AppLock | undefined): string {
  const was = versionsIn(before);
  const now = versionsIn(after);
  const parts: string[] = [];
  for (const [name, v] of now) {
    const old = was.get(name);
    if (old === undefined) parts.push(`now uses ${name} ${v}`);
    else if (old !== v) parts.push(`${name} ${v} (was ${old})`);
  }
  for (const [name, v] of was) if (!now.has(name)) parts.push(`no longer uses ${name} ${v}`);
  return parts.join(", ");
}
