// Bundles the realm's worker runtime (src/realm/worker-runtime.ts) into one classic script, which the
// sandboxed frame starts from a blob: URL. Used by the shell's Vite config (`virtual:potyro-realm-worker`)
// and by the host's own tests; nothing else needs it.
import { build } from "esbuild";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REALM_WORKER_ENTRY = join(here, "src/realm/worker-runtime.ts");

/** The worker runtime as source text, and the files it was built from (for a dev server to watch). */
export async function bundleRealmWorker({ minify = true } = {}) {
  const out = await build({
    entryPoints: [REALM_WORKER_ENTRY],
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
  });
  return { code: out.outputFiles[0].text, inputs: Object.keys(out.metafile.inputs).map((p) => resolve(here, p)) };
}

/**
 * A Vite plugin: `import workerSource from "virtual:potyro-realm-worker"` gives the bundled runtime as
 * a string. Built when first imported (and again when one of its files changes), minified for builds.
 */
export function realmWorkerPlugin() {
  const id = "virtual:potyro-realm-worker";
  const resolved = `\0${id}`;
  let minify = true;
  return {
    name: "potyro-realm-worker",
    configResolved(config) {
      minify = config.command === "build";
    },
    resolveId(source) {
      return source === id ? resolved : null;
    },
    async load(loadId) {
      if (loadId !== resolved) return null;
      const { code, inputs } = await bundleRealmWorker({ minify });
      for (const file of inputs) if (!file.includes("node_modules")) this.addWatchFile(file);
      return `export default ${JSON.stringify(code)};`;
    },
  };
}
