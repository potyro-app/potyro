// The bundler's second plugin (#266, #258): everything an app imports that is not `potyro`/`react`.
//
//   import Chart from "https://esm.sh/chart.js@4.4.1?bundle"   → namespace potyro-lib
//   import { weeks } from "./plan.js"                          → namespace potyro-src
//
// Both are read from the app's own file space through a `ModuleSource` and checked against the lock
// before esbuild sees a byte: a library whose bytes changed is refused by name, never run. Nothing
// here fetches — a library that is not in the app yet is an error that says so (CLAUDE.md rule 6).
// Fetching happens once, at install, in `library-fetch.ts`.
//
// The same plugin serves both bundles: the isolate's IIFE and the trusted ESM. In the isolate it also
// marks which library is loading, so a library that reaches for `window` there fails with its own
// name instead of a blank screen (see `wrapForIsolate`).
import { libraryLabel, matchesLock, type AppLock } from "@potyro/store";
import type { EsbuildPlugin } from "./app-bundler.js";

export interface ModuleSource {
  lock: AppLock;
  /** The bytes of a file in the app's space (`.modules/…`, `.src/…`), or null when it is not here. */
  read(file: string): Promise<Uint8Array | null>;
}

export interface ModulePluginOptions {
  /** Isolate bundles: record which library is loading, for `wrapForIsolate`'s message. */
  markLibraries?: boolean;
  /**
   * Inspecting a package before its libraries are fetched: a library with no bytes yet loads as an
   * inert stand-in, so the app's name and shape can be read for the card. Never for running an app.
   */
  standIns?: boolean;
}

export const MODULE_PLUGIN = "potyro-modules";

/** A message for a person, from the plugin. The bundler unwraps esbuild's framing around it. */
export class ModuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModuleError";
  }
}

/** A `ModuleSource` over bytes in memory: a package being inspected, and tests. */
export function memoryModules(lock: AppLock, files: Map<string, Uint8Array>): ModuleSource {
  return { lock, read: async (file) => files.get(file) ?? null };
}

const LOADING = "__potyroLoading";
const markLoading = (label: string | undefined) => `globalThis.${LOADING}=${label === undefined ? "void 0" : JSON.stringify(label)};`;

/**
 * The first statement of the entry and of every module of the app's own: whatever runs from here on
 * is the app's code, not a library's. Kept on the source's first line so error positions do not move.
 */
export const APP_CODE_MARK = markLoading(undefined);

/**
 * Wrap an isolate bundle so a library that crashes while loading is named. The sealed box has no
 * `window` or `document`; a library that touches them at load would otherwise surface as a bare
 * "window is not defined" that a person cannot connect to anything they did.
 */
export function wrapForIsolate(code: string): string {
  return `try {
${code}
} catch (e) {
  var __lib = globalThis.${LOADING};
  if (__lib) {
    if (e instanceof ReferenceError) throw new Error(__lib + " needs a full web page to work (" + e.message + "). Apps in the sealed box do not get one, so this app can only run as yours.");
    throw new Error(__lib + " could not start: " + (e && e.message ? e.message : String(e)));
  }
  throw e;
}`;
}

/** Whether an error is `wrapForIsolate`'s: a library that could not start in the sealed box. */
export function isLibraryStartError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /needs a full web page to work \(|could not start: /.test(message);
}

/** Anything, called or read or built, is itself: enough for an app's top level to run and say who it is. */
const STAND_IN = `var h = new Proxy(function () {}, {
  get: function (_t, k) {
    if (k === Symbol.toPrimitive) return function () { return ""; };
    if (k === Symbol.iterator) return function () { return [][Symbol.iterator](); };
    if (k === "then" || k === "__esModule") return undefined;
    return h;
  },
  apply: function () { return h; },
  construct: function () { return h; },
  // esbuild reads a named import off an object whose prototype is this module's: point it back here.
  getPrototypeOf: function () { return h; },
});
module.exports = h;`;

const LOADERS: Record<string, string> = { ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", json: "json" };

/** `src/` path candidates for a relative import: as written, `.js` read as `.ts`, or no extension. */
function candidates(path: string): string[] {
  const out = [path];
  const ext = /\.(m?js|jsx)$/.exec(path);
  if (ext) {
    const stem = path.slice(0, -ext[0].length);
    out.push(`${stem}.ts`, `${stem}.tsx`);
  } else if (!/\.(ts|tsx|json)$/.test(path)) {
    for (const e of [".ts", ".tsx", ".js", ".jsx", ".json", "/index.ts", "/index.tsx", "/index.js"]) out.push(path + e);
  }
  return out;
}

/** Join a relative import onto the importing module's folder, inside `src/`; null when it climbs out. */
function joinSrc(fromFile: string, spec: string): string | null {
  const parts = fromFile.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length <= 1) return null; // `src` itself is the floor
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

function readable(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** The plugin. `mods` is undefined for an app with no package: then every such import is refused. */
export function packageModulesPlugin(mods: ModuleSource | undefined, opts: ModulePluginOptions = {}): EsbuildPlugin {
  const lock = mods?.lock ?? {};
  return {
    name: MODULE_PLUGIN,
    setup(build) {
      build.onResolve({ filter: /^https?:\/\// }, (args) => ({ path: args.path, namespace: "potyro-lib" }));

      // An import inside a library: `/x@1/es2022/x.mjs`, `./y.mjs` — resolved as the browser would,
      // against the URL the importing file was served from.
      build.onResolve({ filter: /.*/, namespace: "potyro-lib" }, (args) => {
        if (!/^(\/|\.\.?\/)/.test(args.path)) {
          throw new ModuleError(
            `${libraryLabel(args.importer)} imports "${args.path}", which is not a web address. Only libraries built for the browser work, like https://esm.sh/name@1.2.3?bundle.`,
          );
        }
        const base = lock[args.importer]?.base ?? args.importer;
        return { path: new URL(args.path, base).href, namespace: "potyro-lib" };
      });

      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        const from = args.namespace === "potyro-src" ? args.importer : "src/app";
        const joined = joinSrc(from, args.path);
        if (joined === null) throw new ModuleError(`"${args.path}" is outside the app's own files.`);
        if (!mods) throw new ModuleError(`This app imports "${args.path}" from another file, and only an app added from its package has other files.`);
        const found = candidates(joined).find((p) => lock[p]);
        if (!found) throw new ModuleError(`This app imports "${args.path}", which is not one of its files.`);
        return { path: found, namespace: "potyro-src" };
      });

      build.onLoad({ filter: /.*/, namespace: "potyro-lib" }, async (args) => {
        const label = libraryLabel(args.path);
        const entry = lock[args.path];
        const bytes = entry && mods ? await mods.read(entry.file) : null;
        if (!entry || !bytes) {
          if (opts.standIns) return { contents: STAND_IN, loader: "js" };
          if (!entry) throw new ModuleError(`This app uses ${label}, which is not part of this app yet. Add the app again from its package to fetch it.`);
          throw new ModuleError(`${label} is not on this device, so this app cannot open here yet.`);
        }
        if (!(await matchesLock(entry, bytes))) {
          throw new ModuleError(`${label} is not the copy this app was installed with, so it was not run. Add the app again to restore it.`);
        }
        const code = readable(bytes);
        return { contents: opts.markLibraries ? markLoading(label) + code : code, loader: "js" };
      });

      build.onLoad({ filter: /.*/, namespace: "potyro-src" }, async (args) => {
        const name = args.path.replace(/^src\//, "");
        const entry = lock[args.path];
        const bytes = entry && mods ? await mods.read(entry.file) : null;
        if (!entry || !bytes) throw new ModuleError(`This app's file ${name} is not on this device, so it cannot open here yet.`);
        if (!(await matchesLock(entry, bytes))) throw new ModuleError(`This app's file ${name} was changed outside the app, so it was not run.`);
        const loader = LOADERS[name.split(".").pop() ?? ""] ?? "ts";
        const code = readable(bytes);
        return { contents: opts.markLibraries && loader !== "json" ? APP_CODE_MARK + code : code, loader };
      });
    },
  };
}

/** Whether a lock names any library: only then does an isolate bundle need the loading marks. */
export function hasLibraries(mods: ModuleSource | undefined): boolean {
  return !!mods && Object.keys(mods.lock).some((k) => /^https?:\/\//.test(k));
}

/** esbuild reports a plugin's error inside its own framing; a person should read just the sentence. */
export function unwrapBuildError(e: unknown): unknown {
  const errors = (e as { errors?: Array<{ text?: string; pluginName?: string }> })?.errors;
  const ours = errors?.find((x) => x.pluginName === MODULE_PLUGIN);
  return ours?.text ? new ModuleError(ours.text) : e;
}
