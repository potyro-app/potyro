// Bundles the realm's runtimes into classic scripts:
//   - the worker runtime (src/realm/worker-runtime.ts), which the logic frame starts from a blob: URL;
//   - the view runtime (src/realm/view-runtime.ts, #267), inlined into each view frame's srcdoc, with
//     React and ReactDOM inside it — a sealed custom view renders with the frame's own React.
// Used by the shell's Vite config (`virtual:potyro-realm-worker`, `virtual:potyro-realm-view`) and by
// the host's own tests; nothing else needs them.
import { build } from "esbuild";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REALM_WORKER_ENTRY = join(here, "src/realm/worker-runtime.ts");
export const REALM_VIEW_ENTRY = join(here, "src/realm/view-runtime.ts");

async function bundle(entry, minify) {
  const out = await build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    write: false,
    minify,
    metafile: true,
    absWorkingDir: here,
    legalComments: "none",
    logLevel: "silent",
    // React's own builds pick development or production by this.
    define: { "process.env.NODE_ENV": JSON.stringify(minify ? "production" : "development") },
  });
  return { code: out.outputFiles[0].text, inputs: Object.keys(out.metafile.inputs).map((p) => resolve(here, p)) };
}

/** The worker runtime as source text, and the files it was built from (for a dev server to watch). */
export function bundleRealmWorker({ minify = true } = {}) {
  return bundle(REALM_WORKER_ENTRY, minify);
}

/** The view runtime as source text, and the files it was built from. */
export function bundleRealmView({ minify = true } = {}) {
  return bundle(REALM_VIEW_ENTRY, minify);
}

function virtualModule(name, id, make) {
  const resolved = `\0${id}`;
  let minify = true;
  return {
    name,
    configResolved(config) {
      minify = config.command === "build";
    },
    resolveId(source) {
      return source === id ? resolved : null;
    },
    async load(loadId) {
      if (loadId !== resolved) return null;
      const { code, inputs } = await make({ minify });
      for (const file of inputs) if (!file.includes("node_modules")) this.addWatchFile(file);
      return `export default ${JSON.stringify(code)};`;
    },
  };
}

/**
 * A Vite plugin: `import workerSource from "virtual:potyro-realm-worker"` gives the bundled worker
 * runtime as a string, and `import viewSource from "virtual:potyro-realm-view"` the view runtime. Each
 * is built when first imported (and again when one of its files changes), minified for builds.
 */
export function realmWorkerPlugin() {
  return virtualModule("potyro-realm-worker", "virtual:potyro-realm-worker", bundleRealmWorker);
}

export function realmViewPlugin() {
  return virtualModule("potyro-realm-view", "virtual:potyro-realm-view", bundleRealmView);
}
