import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { linguiBabelPlugin, linguiVitePlugins } from "@potyro/i18n/build.mjs";
import { realmWorkerPlugin } from "@potyro/host/realm-build.mjs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
// Relative, so the config's own bundler compiles them: the share service is plain Node + TypeScript.
import { createShareHandler, type ShareRequest } from "../share-links/src/handler.ts";
import { memoryShareStore } from "../share-links/src/store.ts";
import { LIMITS as SHARE_LIMITS } from "../share-links/src/wire.ts";

/**
 * The shell's own CSP (#272, docs/22 §3.2): it embeds no frame that fetches, so `frame-src 'none'`.
 * A shared app's realm is a srcdoc iframe — not a fetch, so it still loads — and this is what stops
 * that frame navigating itself to a URL (which its sandbox allows and its own CSP cannot). The same
 * policy is a <meta> in index.html, which is what the Capacitor WebView gets (it serves no headers);
 * the header here and in deploy/apps.vaz.io.conf is the same policy again, for the dev server,
 * `vite preview` and the deployed site. Keep all three in step.
 */
const SHELL_CSP = "frame-src 'none'";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Mirrors packages/generator/src/cli-backend.ts — keep in step. */
const NO_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "Task"];
const GEN_TIMEOUT_MS = 300_000;
const JOB_TTL_MS = 600_000; // a finished job nobody polls is dropped after this

interface GenJob {
  status: "running" | "done" | "error";
  text?: string;
  error?: string;
  startedAt: number;
}

/**
 * Dev-only generation via the local `claude -p` CLI — no API key (reuses your Claude Code auth).
 *
 * JOB-BASED, not a long-held request. A generation takes 40-90s, and any page reload — an HMR update,
 * a vite.config restart, a stray refresh — aborts an in-flight fetch and surfaces as a bare
 * "NetworkError" with the work thrown away. So:
 *
 *   POST /__generate { system?, prompt }  -> { id }         (returns immediately)
 *   GET  /__generate?id=<id>              -> { status, text? | error? }
 *
 * The client polls. A reload now costs nothing: the job keeps running and can be re-attached.
 *
 * The invocation MUST match the eval harness (packages/generator/src/cli-backend.ts) or the Studio
 * generates under different conditions than anything measured: contract via `--system-prompt-file`
 * (REPLACING Claude Code's agent prompt), tools disallowed, prompt on stdin.
 */
function claudeCliPlugin(): Plugin {
  const jobs = new Map<string, GenJob>();
  let seq = 0;

  return {
    name: "potyro-claude-cli",
    configureServer(server) {
      server.middlewares.use("/__generate", (req, res) => {
        const send = (status: number, payload: unknown): void => {
          res.statusCode = status;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(payload));
        };

        if (req.method === "GET") {
          const id = new URL(req.url ?? "", "http://x").searchParams.get("id") ?? "";
          const job = jobs.get(id);
          if (!job) return send(404, { error: "unknown job" });
          if (job.status === "running") return send(200, { status: "running", elapsedMs: Date.now() - job.startedAt });
          jobs.delete(id); // one read per finished job; the client has it now
          return send(200, job.status === "done" ? { status: "done", text: job.text } : { status: "error", error: job.error });
        }

        if (req.method !== "POST") return send(405, { error: "POST to start, GET ?id= to poll" });

        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          let prompt = "";
          let system = "";
          try {
            const parsed = JSON.parse(body) as { prompt?: unknown; system?: unknown };
            prompt = String(parsed.prompt ?? "");
            system = String(parsed.system ?? "");
          } catch {
            return send(400, { error: "invalid request body" });
          }
          if (!prompt) return send(400, { error: "missing prompt" });

          const id = `gen-${Date.now()}-${++seq}`;
          const job: GenJob = { status: "running", startedAt: Date.now() };
          jobs.set(id, job);
          send(202, { id });

          const dir = mkdtempSync(join(tmpdir(), "potyro-gen-"));
          const args = ["-p", "--output-format", "text", "--disallowedTools", ...NO_TOOLS];
          if (system) {
            const sysFile = join(dir, "system.txt");
            writeFileSync(sysFile, system);
            args.push("--system-prompt-file", sysFile);
          }

          const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
          let out = "";
          let err = "";
          const settle = (patch: Partial<GenJob>): void => {
            if (job.status !== "running") return;
            Object.assign(job, patch);
            clearTimeout(timer);
            rmSync(dir, { recursive: true, force: true });
            // Don't leak a job nobody collects.
            setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref?.();
          };
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            settle({ status: "error", error: `claude -p timed out after ${GEN_TIMEOUT_MS / 1000}s` });
          }, GEN_TIMEOUT_MS);

          child.stdout.on("data", (d) => (out += d));
          child.stderr.on("data", (d) => (err += d));
          child.on("error", (e) => settle({ status: "error", error: `claude CLI unavailable: ${e.message}` }));
          child.on("close", (code) => {
            if (code !== 0) settle({ status: "error", error: err.trim() || `claude exited ${code}` });
            else settle({ status: "done", text: out });
          });
          child.stdin.end(prompt);
        });
      });
    },
  };
}

/**
 * The share service (docs/24 §4) inside the dev server and `vite preview`, so hosted demo links and
 * their preview pages work where the browser tests run. Shares live in memory for the server's life;
 * the deployed service keeps them on disk (packages/share-links, docs/16).
 */
function shareLinksPlugin(): Plugin {
  const store = memoryShareStore();
  const middleware = (indexHtml: (path: string) => Promise<string>) => {
    const handle = createShareHandler({ store, indexHtml, limits: { perAddress: 100_000, windowMs: 60_000 } });
    return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
      const path = (req.url ?? "/").split("?")[0]!;
      if (!/\/share-api\/|\/s\/[A-Za-z0-9_-]{22}(\/|$)/.test(path)) return next();
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size <= SHARE_LIMITS.requestBytes) chunks.push(c);
      });
      req.on("end", () => {
        const headers: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v[0] : v;
        const request: ShareRequest = { method: req.method ?? "GET", path, headers, body: new Uint8Array(Buffer.concat(chunks)), ip: req.socket.remoteAddress ?? "local" };
        void handle(size > SHARE_LIMITS.requestBytes ? { ...request, body: new Uint8Array(SHARE_LIMITS.requestBytes + 1) } : request).then((r) => {
          res.writeHead(r.status, r.headers);
          res.end(r.body);
        });
      });
    };
  };
  return {
    name: "potyro-share-links",
    configureServer(server) {
      server.middlewares.use(middleware(async (path) => server.transformIndexHtml(path, await readFile(here("./index.html"), "utf8"))));
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(() => readFile(here("./dist/index.html"), "utf8")));
    },
  };
}

/** Where the service worker finds the list of language chunks to precache (public/sw.js reads it). */
const CATALOG_MANIFEST = "i18n-precache.json";

/**
 * Write the list of per-language catalog chunks the build produced, for the service worker.
 *
 * Each language is a lazy chunk (packages/i18n/src/i18n.ts), so a person who has only ever used the
 * app in English has never fetched Polish — and the worker caches what it has seen. Switching
 * language on a plane would then fail. The chunk names are content-hashed and only known after the
 * build, so the worker cannot list them itself: this writes them down, and its install step
 * fetches every one.
 */
function precacheCatalogs(): Plugin {
  let base = "/";
  return {
    name: "potyro-precache-catalogs",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    generateBundle(_options, bundle) {
      const files = Object.values(bundle)
        .filter((c) => c.type === "chunk" && /[\\/]locales[\\/][^\\/]+[\\/]messages\.po$/.test(c.facadeModuleId ?? ""))
        .map((c) => `${base}${c.fileName}`)
        .sort();
      this.emitFile({ type: "asset", fileName: CATALOG_MANIFEST, source: `${JSON.stringify({ files }, null, 2)}\n` });
    },
  };
}

// `pnpm dev` runs trusted; `pnpm dev:sandbox` (mode "sandbox") runs the examples untrusted, in the
// browser realm (or in QuickJS with VITE_POTYRO_SANDBOX=quickjs: `pnpm dev:sandbox:quickjs`).
export default defineConfig({
  // The Lingui macros compile in plugin-react's Babel pass, and `.po` catalogs load as compiled JS
  // (packages/i18n/build.mjs). `precacheCatalogs` tells the service worker which chunks are languages.
  // `realmWorkerPlugin` serves the realm's worker runtime as `virtual:potyro-realm-worker` (#272).
  plugins: [react({ babel: { plugins: [linguiBabelPlugin()] } }), linguiVitePlugins(), precacheCatalogs(), claudeCliPlugin(), realmWorkerPlugin(), shareLinksPlugin()],
  // The example .app.ts fixtures live OUTSIDE packages/shell, so their custom-view components
  // (which use React hooks) could otherwise resolve a second React module instance → "Invalid
  // hook call". Dedupe forces a single React across the app and the example modules.
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react/jsx-runtime"],
    // Packages the dep pre-bundler mishandles: the emscripten/wasm ones (it rewrites them into
    // .vite/deps and fails to serve the sibling .wasm with the correct MIME → dev boot aborts with
    // "expected magic word 00 61 73 6d"), and maplibre-gl (its worker .mjs isn't emitted into
    // .vite/deps). Excluding them lets Vite serve those assets directly.
    exclude: ["quickjs-emscripten", "@sqlite.org/sqlite-wasm", "maplibre-gl"],
  },
  server: {
    port: 5173,
    fs: { allow: [repoRoot] },
    headers: { "Content-Security-Policy": SHELL_CSP },
  },
  preview: {
    headers: { "Content-Security-Policy": SHELL_CSP },
  },
});
