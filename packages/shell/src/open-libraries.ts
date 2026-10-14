// An app's libraries, the first time it opens on this device (#281).
//
// An app that arrives by share link, from your account, or as a collaborator's update carries its
// lock and its own modules — never its libraries' bytes (`carried-code.ts` in the store says why).
// Opening it is where the bytes are fetched: the same fetch as Add an app (`library-fetch.ts`), host
// side, once, after the person said yes to the same card line — "fetches chart.js 4.4.1, 190 KB, from
// esm.sh". Every byte is checked against the lock that came with the app, so an address that no longer
// serves those bytes is refused by the library's name and nothing is kept. Kept, they are on this
// device for good, and the app opens with no network from then on (CLAUDE.md rule 6: the run never
// fetches; this is the install, done late).
//
// An app shared before locks travelled has none: its libraries are fetched fresh, with the same
// consent, and locked here — exactly what adding a package without a lock does.
import { fmt } from "@potyro/i18n";
import { plural, t } from "@lingui/core/macro";
import { libraryHost, libraryLabel, sameCode, type AppLock, type PackagedFile, type Store } from "@potyro/store";
import { getEsbuild, type EsbuildLike } from "./app-bundler.js";
import { browserGet, fetchLibraries, type HttpGet } from "./library-fetch.js";
import type { LibraryLine } from "./package-libraries.js";
import { memoryModules, type ModuleSource } from "./package-modules.js";
import { rootsOf } from "./studio-libraries.js";
import type { UserApp } from "./user-apps.js";

export interface OpenLibrariesDeps {
  esbuild?: EsbuildLike;
  get?: HttpGet;
  /** The person's say-so, given the lines a card would show. Asked once, before anything is fetched. */
  ask: (lines: LibraryLine[]) => Promise<boolean>;
  /** Keep fetched files on this device (`keepCode`). */
  keep: (files: PackagedFile[]) => Promise<void>;
}

export type LibrariesReady =
  | {
      ok: true;
      /** The lock to open with — and to save on the app when it differs from the one it had. */
      lock: AppLock | undefined;
      modules: ModuleSource | undefined;
      /** What was fetched just now, with sizes. Empty when everything was already here. */
      fetched: LibraryLine[];
    }
  | { ok: false; message: string };

const isUrl = (key: string): boolean => /^https?:\/\//.test(key);

/** Bytes, per library: every file of it the lock holds. Undefined when the lock does not name it. */
function sizeIn(lock: AppLock | undefined, url: string): number | undefined {
  if (!lock?.[url]) return undefined;
  const label = libraryLabel(url);
  return Object.entries(lock)
    .filter(([k]) => isUrl(k) && libraryLabel(k) === label)
    .reduce((n, [, e]) => n + e.size, 0);
}

/** The libraries that are not all here: not in the lock, or a file of theirs not on this device. */
async function missing(roots: string[], lock: AppLock | undefined, have: ModuleSource | undefined): Promise<string[]> {
  const absent = new Set<string>();
  for (const [key, entry] of Object.entries(lock ?? {})) {
    if (isUrl(key) && !(have && (await have.read(entry.file)))) absent.add(libraryLabel(key));
  }
  return roots.filter((url) => !lock?.[url] || absent.has(libraryLabel(url)));
}

function listOf(names: string[]): string {
  return fmt.list(names);
}

/**
 * Make sure every library the app imports is on this device, fetching what is not — with consent —
 * and checking it against the app's lock. `have` is what the device holds now (`deviceModules`).
 */
export async function librariesForOpen(
  app: { name: string; source: string; lock?: AppLock },
  have: ModuleSource | undefined,
  deps: OpenLibrariesDeps,
): Promise<LibrariesReady> {
  const roots = await rootsOf(app.source, have);
  const absent = roots.length ? await missing(roots, app.lock, have) : [];
  if (!absent.length) return { ok: true, lock: app.lock, modules: have, fetched: [] };

  const lines: LibraryLine[] = absent.map((url) => ({ url, label: libraryLabel(url), host: libraryHost(url), here: false, size: sizeIn(app.lock, url) }));
  if (!(await deps.ask(lines))) {
    const name = app.name;
    const what = listOf(lines.map((l) => l.label));
    return {
      ok: false,
      message: plural(lines.length, {
        one: `“${name}” can’t open until it has ${what}. Open it again to fetch it.`,
        other: `“${name}” can’t open until it has ${what}. Open it again to fetch them.`,
      }),
    };
  }

  const held = have ?? memoryModules({}, new Map());
  let result: Awaited<ReturnType<typeof fetchLibraries>>;
  try {
    result = await fetchLibraries(roots, { esbuild: deps.esbuild ?? (await getEsbuild()), get: deps.get ?? browserGet, have: held, pinned: app.lock });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  const own = Object.fromEntries(Object.entries(app.lock ?? {}).filter(([k]) => !isUrl(k)));
  const lock: AppLock = { ...result.lock, ...own };
  const fresh = new Map<string, Uint8Array>();
  for (const f of result.files) if (!(await held.read(f.path))) fresh.set(f.path, f.data);
  await deps.keep([...fresh].map(([path, data]) => ({ path, data, mime: "text/javascript" })));
  return {
    ok: true,
    lock,
    modules: { lock, read: async (file) => fresh.get(file) ?? held.read(file) },
    fetched: lines.map((l) => ({ ...l, size: sizeIn(result.lock, l.url) })),
  };
}

/** The question, in the card's own words: "It fetches chart.js 4.4.1, 190 KB, from esm.sh, once." */
export async function askToFetch(name: string, lines: LibraryLine[]): Promise<boolean> {
  const [{ shellDialogs }, { describeLibrary }] = await Promise.all([import("./dialog.js"), import("./package-libraries.js")]);
  const what = lines.length === 1 ? lines[0]!.label : plural(lines.length, { one: "# library", other: "# libraries" });
  const fetches = fmt.list(lines.map((l) => describeLibrary(l)));
  return shellDialogs.confirm(t`“${name}” needs ${what} on this device.`, {
    detail: t({ message: `It ${fetches}, once. After that it opens without the internet.`, comment: "fetches is one or more of “fetches chart.js 4.4.1, 190 KB, from esm.sh”" }),
    ok: t`Fetch and open`,
    cancel: t`Not now`,
  });
}

/**
 * The modules an app opens with, on this device: what it holds (`deviceModules`), plus whatever its
 * libraries still need, fetched now with consent. A lock this device made afresh is saved on the app.
 * `{ message }` when it cannot open yet — declined, or a library refused — in words for the person.
 */
export async function codeForOpen(
  app: UserApp,
  store: Store,
  synced: boolean,
): Promise<{ modules: ModuleSource | undefined } | { message: string }> {
  const [{ deviceModules, keepCode }, { setUserAppLock }] = await Promise.all([import("./app-modules.js"), import("./user-apps.js")]);
  const ready = await librariesForOpen(app, await deviceModules(app, store, synced), {
    ask: (lines) => askToFetch(app.name, lines),
    keep: (files) => keepCode(app.id, files),
  });
  if (!ready.ok) return { message: ready.message };
  if (!sameCode(ready.lock, app.lock)) setUserAppLock(app.id, ready.lock);
  return { modules: ready.modules };
}
