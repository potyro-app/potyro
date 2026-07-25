import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

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
  plugins: [react(), sandboxBundlePlugin()],
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
