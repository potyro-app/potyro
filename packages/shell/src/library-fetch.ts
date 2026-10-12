// Fetching an app's libraries (#266): once, at install, with the person's consent — never at run
// time (CLAUDE.md rule 6). This is a host action like fetching a share link; app code has no part in
// it and `ctx.caps.network` is not involved.
//
// A library URL is rarely one file. esm.sh answers `chart.js@4.4.1?bundle` with a one-line module
// that re-exports `/chart.js@4.4.1/es2022/chart.bundle.mjs`, and a library built without `?bundle`
// imports each of its dependencies the same way. So this walks the WHOLE import graph — absolute
// paths, relative paths and literal dynamic imports — with esbuild doing the parsing, and locks every
// file it reached. An app must never break offline because a file it needs was left behind, so
// anything that cannot be followed is refused, by the library's name, and nothing half-locked is kept:
//
//   - a URL without an exact version (it could mean different code tomorrow);
//   - a file the host does not serve;
//   - a bare package name inside a library (`import "left-pad"` has no address to fetch);
//   - a library that decides while it runs what else to load (`import(someVariable)`) — mentioning
//     `require` is not that: a browser has none, so it loads nothing;
//   - a library that fetches files of its own beside it while it runs (`new URL("x.wasm",
//     import.meta.url)`): those are not imports, so no walk can find them ahead of time.
import { integrityOf, isPinned, libraryLabel, lockEntryFor, matchesLock, moduleFileFor, type AppLock, type PackagedFile } from "@potyro/store";
import type { EsbuildLike, EsbuildPlugin } from "./app-bundler.js";
import type { ModuleSource } from "./package-modules.js";

/** One GET. `url` is where the bytes really came from, after redirects. */
export type HttpGet = (url: string) => Promise<{ ok: boolean; status: number; url: string; bytes(): Promise<Uint8Array> }>;

export interface FetchLibrariesDeps {
  esbuild: EsbuildLike;
  get: HttpGet;
  /** Bytes the app already holds, reused when they still match: an update fetches only what is new. */
  have?: ModuleSource;
  /** What a package says its libraries must hash to: fetched bytes that differ are refused. */
  pinned?: AppLock;
}

export interface FetchedLibraries {
  /** Every file reached, by URL. */
  lock: AppLock;
  /** Their bytes, as `.modules/<sha256>.js` files to ship in the app's space. */
  files: PackagedFile[];
}

export class LibraryFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibraryFetchError";
  }
}

const FETCH_PLUGIN = "potyro-fetch";
/**
 * What esbuild makes of an `import(x)` it could not follow, with dynamic imports marked unsupported:
 * `Promise.resolve().then(() => __toESM(__require(x)))`. Only that shape counts. A library that merely
 * mentions `require` — a browserify prelude's `typeof require == "function" && require`, esm.sh's own
 * require shim, `globalThis.require("vertx")` — also gets the `__require` helper, but in a
 * browser `require` loads nothing, so it behaves the same offline as online (p5 1.x is one, #266).
 */
const UNRESOLVED_IMPORT = /\.then\(\(\) => __toESM\d*\(__require\d*\(/;
/** A file located relative to the module itself, to be loaded at run time: a worker, wasm, a font. */
const BESIDE_ITSELF = /\bimport\.meta\.(url|resolve)\b/;

/** The browser's own fetch, which follows redirects and reports where it ended up. */
export const browserGet: HttpGet = async (url) => {
  const res = await globalThis.fetch(url, { redirect: "follow" });
  return { ok: res.ok, status: res.status, url: res.url || url, bytes: async () => new Uint8Array(await res.arrayBuffer()) };
};

/** Why a library URL cannot be locked as written, or undefined when it can. */
export function unusableLibraryUrl(url: string): string | undefined {
  if (!/^https:\/\//.test(url)) return `"${url}" is not an https address, so it cannot be fetched safely.`;
  if (!isPinned(url)) return `"${url}" does not name an exact version, so it could change under the app. Pin one, like https://esm.sh/chart.js@4.4.1?bundle.`;
  return undefined;
}

function plugin(root: string, deps: FetchLibrariesDeps, lock: AppLock, files: Map<string, Uint8Array>): EsbuildPlugin {
  const label = libraryLabel(root);
  return {
    name: FETCH_PLUGIN,
    setup(build) {
      build.onResolve({ filter: /^https?:\/\// }, (args) => ({ path: args.path, namespace: "net" }));
      build.onResolve({ filter: /.*/, namespace: "net" }, (args) => {
        if (!/^(\/|\.\.?\/)/.test(args.path)) {
          throw new LibraryFetchError(`${libraryLabel(args.importer)} imports "${args.path}", which is not a web address, so ${label} cannot be kept on this device.`);
        }
        return { path: new URL(args.path, lock[args.importer]?.base ?? args.importer).href, namespace: "net" };
      });
      build.onLoad({ filter: /.*/, namespace: "net" }, async (args) => {
        const url = args.path;
        const known = deps.have?.lock[url];
        const kept = known ? await deps.have!.read(known.file) : null;
        let bytes: Uint8Array;
        let base: string | undefined;
        if (known && kept && (await matchesLock(known, kept))) {
          bytes = kept;
          base = known.base;
        } else {
          let res: Awaited<ReturnType<HttpGet>>;
          try {
            res = await deps.get(url);
          } catch (e) {
            throw new LibraryFetchError(`${libraryLabel(url)} could not be fetched from ${new URL(url).host}: ${e instanceof Error ? e.message : String(e)}`);
          }
          if (!res.ok) throw new LibraryFetchError(`${libraryLabel(url)} could not be fetched: ${new URL(url).host} answered ${res.status} for ${url}`);
          bytes = await res.bytes();
          base = res.url && res.url !== url ? res.url : undefined;
          const want = deps.pinned?.[url];
          if (want && (await integrityOf(bytes)) !== want.integrity) {
            throw new LibraryFetchError(`${libraryLabel(url)} from ${new URL(url).host} is not the copy this app was made with, so it was not added.`);
          }
        }
        if (BESIDE_ITSELF.test(new TextDecoder().decode(bytes))) {
          throw new LibraryFetchError(`${libraryLabel(url)} loads files of its own while it runs, so ${label} cannot be kept on this device for use offline.`);
        }
        const file = await moduleFileFor(bytes);
        lock[url] = await lockEntryFor(file, bytes, base);
        files.set(file, bytes);
        return { contents: new TextDecoder().decode(bytes), loader: "js" };
      });
    },
  };
}

/**
 * Fetch every file the libraries at `urls` need, and lock them. Throws a `LibraryFetchError` that a
 * person can read, and returns nothing partial, when any of it cannot be kept.
 */
export async function fetchLibraries(urls: string[], deps: FetchLibrariesDeps): Promise<FetchedLibraries> {
  for (const url of urls) {
    const why = unusableLibraryUrl(url);
    if (why) throw new LibraryFetchError(why);
  }
  const lock: AppLock = {};
  const files = new Map<string, Uint8Array>();
  // One walk per library, so whatever goes wrong is said about the library the person asked for.
  for (const root of urls) {
    let out: string;
    try {
      const result = await deps.esbuild.build({
        stdin: { contents: `import * as lib from ${JSON.stringify(root)};\nexport { lib };`, loader: "js", sourcefile: "libraries.js" },
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        logLevel: "silent",
        // A dynamic import esbuild cannot follow then shows up as its `require` helper, below.
        supported: { "dynamic-import": false },
        plugins: [plugin(root, deps, lock, files)],
      });
      out = result.outputFiles[0]!.text;
    } catch (e) {
      const errors = (e as { errors?: Array<{ text?: string; pluginName?: string }> }).errors;
      const ours = errors?.find((x) => x.pluginName === FETCH_PLUGIN)?.text;
      if (ours) throw new LibraryFetchError(ours);
      const first = errors?.[0]?.text;
      throw new LibraryFetchError(`${libraryLabel(root)} could not be read as a JavaScript module${first ? `: ${first}` : ""}.`);
    }
    if (UNRESOLVED_IMPORT.test(out)) {
      throw new LibraryFetchError(`${libraryLabel(root)} decides while it runs what else to load, so it cannot be kept on this device for use offline.`);
    }
  }
  return { lock, files: [...files].map(([path, data]) => ({ path, data, mime: "text/javascript" })) };
}
