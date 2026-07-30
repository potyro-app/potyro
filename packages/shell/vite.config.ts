import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import react from "@vitejs/plugin-react";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Mirrors packages/generator/src/cli-backend.ts — keep in step. */
const NO_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "Task"];
const GEN_TIMEOUT_MS = 300_000;

/**
 * Dev-only generation via the local `claude -p` CLI — so the "Describe an app…" panel can generate
 * without pasting an API key (it reuses your existing Claude Code auth). POST /__generate
 * { prompt, system? } → `claude -p` → { text }. Never part of the built app.
 *
 * Invocation MUST match the eval harness (packages/generator/src/cli-backend.ts) or the Studio
 * generates under different conditions than anything measured: the contract goes in via
 * `--system-prompt-file` (REPLACING Claude Code's own agent prompt, rather than being buried in the
 * user text) and tools are disallowed so generation can never wander into the repo. The prompt
 * arrives on stdin instead of argv — no shell/length surprises with a 10KB+ contract.
 */
function claudeCliPlugin(): Plugin {
  return {
    name: "karta-claude-cli",
    configureServer(server) {
      server.middlewares.use("/__generate", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
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
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "invalid request body" }));
            return;
          }
          if (!prompt) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "missing prompt" }));
            return;
          }

          const dir = mkdtempSync(join(tmpdir(), "karta-gen-"));
          const args = ["-p", "--output-format", "text", "--disallowedTools", ...NO_TOOLS];
          if (system) {
            const sysFile = join(dir, "system.txt");
            writeFileSync(sysFile, system);
            args.push("--system-prompt-file", sysFile);
          }

          const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
          let out = "";
          let err = "";
          let settled = false;
          const finish = (status: number, payload: Record<string, unknown>): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            rmSync(dir, { recursive: true, force: true });
            res.statusCode = status;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(payload));
          };
          // A generation that hangs would otherwise leave the browser waiting forever and surface as
          // an opaque "NetworkError" rather than something actionable.
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            finish(504, { error: `claude -p timed out after ${GEN_TIMEOUT_MS / 1000}s` });
          }, GEN_TIMEOUT_MS);

          child.stdout.on("data", (d) => (out += d));
          child.stderr.on("data", (d) => (err += d));
          child.on("error", (e) => finish(500, { error: `claude CLI unavailable: ${e.message}` }));
          child.on("close", (code) => {
            if (code !== 0) finish(500, { error: err.trim() || `claude exited ${code}` });
            else finish(200, { text: out });
          });
          child.stdin.end(prompt);
        });
      });
    },
  };
}

/**
 * Bundles an example `.app.ts` into a self-contained IIFE string for the untrusted isolate
 * (docs/07 "what a shareable app is"). `karta` and `react` are aliased to tiny isolate stubs so
 * Zod and React never enter the QuickJS bundle. Imported as `virtual:sandbox:<name>`.
 */
function sandboxBundlePlugin(): Plugin {
  const PREFIX = "virtual:sandbox:";
  return {
    name: "karta-sandbox-bundle",
    resolveId(id) {
      if (id.startsWith(PREFIX)) return "\0" + id;
    },
    async load(id) {
      if (!id.startsWith("\0" + PREFIX)) return;
      const name = id.slice(("\0" + PREFIX).length);
      const esbuild = await import("esbuild");
      const result = await esbuild.build({
        entryPoints: [`${repoRoot}examples/${name}.app.ts`],
        bundle: true,
        write: false,
        format: "iife",
        globalName: "__sandbox",
        platform: "browser",
        target: "es2020",
        footer: { js: "globalThis.__kartaApp = (__sandbox && __sandbox.default) ? __sandbox.default : __sandbox;" },
        alias: {
          karta: here("./src/isolate-stubs/karta.ts"),
          react: here("./src/isolate-stubs/react.ts"),
          "react/jsx-runtime": here("./src/isolate-stubs/react.ts"),
          "react/jsx-dev-runtime": here("./src/isolate-stubs/react.ts"),
        },
      });
      const code = result.outputFiles[0]!.text;
      return `export default ${JSON.stringify(code)};`;
    },
  };
}

// `pnpm dev` runs trusted; `pnpm dev:sandbox` (mode "sandbox") runs an example untrusted in the
// QuickJS-WASM isolate.
export default defineConfig({
  plugins: [react(), sandboxBundlePlugin(), claudeCliPlugin()],
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
  },
});
