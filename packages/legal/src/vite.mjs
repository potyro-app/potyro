// The legal pages in the shell (#117): served by its dev server, emitted into its build, and a flag
// the app reads to know whether to link them.
//
// `import.meta.env.VITE_POTYRO_LEGAL` is "1" when the pages exist in this build and "" when they do
// not (docs/legal is not finished: a placeholder, an open point, no Effective date, or the Draft
// note; build.mjs). The shell shows its Privacy and Terms links only when it is "1"
// (packages/shell/src/legal-links.tsx), so no build ever links a page it does not have. `POTYRO_LEGAL_DIR` points the build at another folder of texts (the browser
// test's filled-in copies); unset, it is docs/legal.

import { legalSite } from "./build.mjs";

const TYPES = /** @type {Record<string, string>} */ ({ html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", svg: "image/svg+xml", woff2: "font/woff2" });

/**
 * The file a request for `url` is, among the pages' files: `/privacy`, `/privacy/` and
 * `/privacy.html` are the page, as a deployed server answers them.
 * @param {Map<string, string | Buffer>} files
 * @param {string} url
 */
export function legalFileFor(files, url) {
  const path = decodeURIComponent((url.split(/[?#]/)[0] ?? "").replace(/^\/+/, ""));
  const page = /^(privacy|terms)(?:\/(?:index\.html)?|\.html)?$/.exec(path);
  if (page) return { path: `${page[1]}/index.html`, body: files.get(`${page[1]}/index.html`) };
  return files.has(path) ? { path, body: files.get(path) } : null;
}

/**
 * The parts of Vite's plugin shape this uses, written out so the package needs no Vite of its own.
 * @typedef {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, next: () => void) => void} Middleware
 * @typedef {{ emitFile: (file: { type: "asset"; fileName: string; source: string | Uint8Array }) => string }} EmitContext
 * @typedef {{ name: string; config: () => { define: Record<string, string> }; configureServer: (server: { middlewares: { use: (fn: Middleware) => unknown } }) => void; generateBundle: (this: EmitContext) => void }} LegalPlugin
 */

/**
 * @param {{ dir?: string; log?: (line: string) => void }} [opts]
 * @returns {LegalPlugin}
 */
export function legalPagesPlugin(opts = {}) {
  const log = opts.log ?? ((line) => console.log(line));
  const site = () => legalSite({ dir: opts.dir });
  const first = site();
  return {
    name: "potyro-legal-pages",
    config() {
      return { define: { "import.meta.env.VITE_POTYRO_LEGAL": JSON.stringify(first.ready ? "1" : "") } };
    },
    configureServer(server) {
      if (!first.ready) log(first.notice);
      // Read again on every request, so an edit to the text shows on a reload.
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const now = site();
        const hit = now.ready ? legalFileFor(now.files, req.url ?? "/") : null;
        if (!hit?.body) return next();
        res.setHeader("content-type", TYPES[hit.path.split(".").pop() ?? ""] ?? "application/octet-stream");
        res.setHeader("cache-control", "no-cache");
        res.end(hit.body);
      });
    },
    generateBundle() {
      // The build reads the texts once, at its start: what the flag above says is what is emitted.
      if (!first.ready) {
        log(first.notice);
        return;
      }
      for (const [fileName, source] of first.files) this.emitFile({ type: "asset", fileName, source });
    },
  };
}
