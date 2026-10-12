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

/** The libraries a package uses, for the card, and the problems with any of them. */
export async function inspectLibraries(pkg: AppPackage, deps: PackageDeps = {}): Promise<{ lines: LibraryLine[]; issues: string[]; modules: ModuleSource }> {
  const modules = await packageModules(pkg);
  const lines: LibraryLine[] = [];
  const issues: string[] = [];
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
