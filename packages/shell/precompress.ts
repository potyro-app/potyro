// Brotli and gzip copies of the build's text files, made once at build time (#48).
//
// A server that compresses per request does it quickly, so badly: the page's first script was
// about 650 kB as the server's gzip. Brotli at its highest setting is too slow to run per request
// and about a fifth smaller, and the files never change once built, so the build makes
// `<file>.br` and `<file>.gz` beside each one and the server only picks (Caddy's
// `file_server { precompressed br gzip }`, deploy/potyro.app.Caddyfile).
//
// Only when asked for, with `POTYRO_PRECOMPRESS=1`: the deploy sets it (scripts/ci-local.mjs). The
// same `vite build` makes the folder the Android and iOS apps carry, where the copies would be
// dead weight, and the one the browser tests serve with `vite preview`, which ignores them.
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import type { Plugin } from "vite";

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

/** What compresses: text, and Wasm. Pictures, fonts and the face model are compressed already. */
const COMPRESSIBLE = /\.(?:js|mjs|css|html|svg|json|webmanifest|wasm|txt|xml)$/;
/** Under this a copy saves nothing worth a second file on the server. */
const MIN_BYTES = 1024;
/** Files compressed at once: zlib works on Node's thread pool, four threads by default. */
const AT_ONCE = 4;

export interface Precompressed {
  files: number;
  bytes: number;
  brotliBytes: number;
  gzipBytes: number;
}

async function filesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(path)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

/**
 * Write `<file>.br` and `<file>.gz` beside every compressible file under `dir`. A copy that is not
 * smaller than its file is not written: the server then sends the file itself.
 */
export async function precompressDir(dir: string): Promise<Precompressed> {
  const queue = (await filesUnder(dir)).filter((path) => COMPRESSIBLE.test(path)).sort();
  const total: Precompressed = { files: 0, bytes: 0, brotliBytes: 0, gzipBytes: 0 };
  const worker = async (): Promise<void> => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      if ((await stat(path)).size < MIN_BYTES) continue;
      const source = await readFile(path);
      const [br, zipped] = await Promise.all([
        brotli(source, { params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY, [constants.BROTLI_PARAM_SIZE_HINT]: source.length } }),
        gz(source, { level: constants.Z_BEST_COMPRESSION }),
      ]);
      if (br.length < source.length) await writeFile(`${path}.br`, br);
      if (zipped.length < source.length) await writeFile(`${path}.gz`, zipped);
      total.files += 1;
      total.bytes += source.length;
      total.brotliBytes += Math.min(br.length, source.length);
      total.gzipBytes += Math.min(zipped.length, source.length);
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));
  return total;
}

const mb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

/** The build step: after every file is written, and only when `POTYRO_PRECOMPRESS=1`. */
export function precompress(): Plugin {
  let outDir = "";
  return {
    name: "potyro-precompress",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle: {
      // After the plugins that write into the folder at the end (the legal pages, the worker's stamp).
      order: "post",
      sequential: true,
      async handler() {
        if (process.env.POTYRO_PRECOMPRESS !== "1") return;
        const done = await precompressDir(outDir);
        // eslint-disable-next-line no-console
        console.log(`precompressed ${done.files} files: ${mb(done.bytes)} → ${mb(done.brotliBytes)} brotli, ${mb(done.gzipBytes)} gzip`);
      },
    },
  };
}
