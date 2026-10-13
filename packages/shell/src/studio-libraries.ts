// Libraries in a Studio save (#266): the same rule as Add an app, on the other way in.
//
// A version that imports a library the app does not have yet says so first — "fetches chart.js
// 4.4.1 from esm.sh" — and the fetch is the person's to allow. It happens once, host-side, when the
// version is saved, and never at run time (CLAUDE.md rule 6). The version is checked against the
// fetched bytes before anything is kept, and its lock is saved with it, so History can show a
// library change as a change to lock.json.
//
// The Studio is not taught to write library imports (a scope decision on #266); a person writing the
// code by hand can, and this is what makes that version work.
import { fileSpace, libraryHost, libraryLabel, srcKey, urlImportsOf, type AppLock, type PackagedFile, type Store } from "@potyro/store";
import { getEsbuild, type EsbuildLike } from "./app-bundler.js";
import { browserGet, fetchLibraries, unusableLibraryUrl, type HttpGet } from "./library-fetch.js";
import type { LibraryLine } from "./package-libraries.js";
import type { ModuleSource } from "./package-modules.js";
import type { UserApp } from "./user-apps.js";

const isUrl = (key: string): boolean => /^https?:\/\//.test(key);

/** Every library the version's code imports: its source's, and its own modules'. */
export async function rootsOf(source: string, have: ModuleSource | undefined): Promise<string[]> {
  const texts = [source];
  for (const [key, entry] of Object.entries(have?.lock ?? {})) {
    if (!key.startsWith(srcKey("")) || !/\.[cm]?[jt]sx?$/.test(key)) continue;
    const bytes = await have!.read(entry.file);
    if (bytes) texts.push(new TextDecoder().decode(bytes));
  }
  return [...new Set(texts.flatMap(urlImportsOf))];
}

/** What saving `source` would fetch, for the Studio to say before it does; and any URL it cannot. */
export async function librariesToFetch(source: string, have: ModuleSource | undefined): Promise<{ lines: LibraryLine[]; issues: string[] }> {
  const lines: LibraryLine[] = [];
  const issues: string[] = [];
  for (const url of await rootsOf(source, have)) {
    const why = unusableLibraryUrl(url);
    if (why) issues.push(why);
    else if (!have?.lock[url]) lines.push({ url, label: libraryLabel(url), host: libraryHost(url), here: false });
  }
  return { lines, issues };
}

export interface StudioLibraries {
  /** The lock to save with the version: its libraries' whole graphs and the app's own modules. */
  lock: AppLock;
  /** Library bytes the app does not hold yet, for its folder. */
  files: PackagedFile[];
  /** What the version is bundled from before it is saved. */
  modules: ModuleSource;
  /** What was fetched, with sizes, for the conversation to say. */
  fetched: LibraryLine[];
}

export interface StudioLibraryDeps {
  esbuild?: EsbuildLike;
  get?: HttpGet;
}

/**
 * Lock the version's libraries, fetching what the app does not hold yet (the person already said
 * yes). Null for an app that has no libraries before or after: nothing about its code changes.
 */
export async function prepareStudioLibraries(source: string, have: ModuleSource | undefined, deps: StudioLibraryDeps = {}): Promise<StudioLibraries | null> {
  const roots = await rootsOf(source, have);
  const before = have?.lock ?? {};
  if (!roots.length && !Object.keys(before).some(isUrl)) return null;
  const own = Object.fromEntries(Object.entries(before).filter(([k]) => !isUrl(k)));
  const result = roots.length
    ? await fetchLibraries(roots, { esbuild: deps.esbuild ?? (await getEsbuild()), get: deps.get ?? browserGet, have })
    : { lock: {}, files: [] };
  const lock: AppLock = { ...result.lock, ...own };
  const fresh = new Map<string, Uint8Array>();
  for (const f of result.files) if (!have || !(await have.read(f.path))) fresh.set(f.path, f.data);
  const fetched: LibraryLine[] = roots
    .filter((u) => !before[u])
    .map((u) => {
      const label = libraryLabel(u);
      const size = Object.entries(result.lock)
        .filter(([k]) => libraryLabel(k) === label)
        .reduce((n, [, e]) => n + e.size, 0);
      return { url: u, label, host: libraryHost(u), here: false, size };
    });
  return {
    lock,
    files: [...fresh].map(([path, data]) => ({ path, data, mime: "text/javascript" })),
    modules: { lock, read: async (file) => fresh.get(file) ?? (have ? have.read(file) : null) },
    fetched,
  };
}

/** Keep fetched library bytes in the app's folder, as the app's code that came with it. */
export async function writeLibraryFiles(store: Store, files: PackagedFile[]): Promise<void> {
  const space = fileSpace(store);
  for (const f of files) await space.write(f.path, new Blob([f.data as BlobPart], { type: "text/javascript" }), { origin: "shipped", mime: "text/javascript" });
}

/**
 * Keep fetched library bytes for a saved app, on this device: in its local store, which for an app
 * whose data syncs is not its space — the bytes never ride to the relay (#281).
 */
export async function keepLibraryFiles(app: UserApp, files: PackagedFile[]): Promise<void> {
  const { keepCode } = await import("./app-modules.js");
  await keepCode(app.id, files.map((f) => ({ ...f, mime: "text/javascript" })));
}
