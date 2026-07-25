import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { bundleAppSource, type EsbuildLike } from "../src/app-bundler.js";

// The runtime bundler must turn a generated/imported `.app.ts` into the isolate IIFE — verified in
// Node with the native esbuild + the real isolate stubs, then evaluated to confirm it yields the app.

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const stubs = {
  karta: readFileSync(here("../src/isolate-stubs/karta.ts"), "utf8"),
  react: readFileSync(here("../src/isolate-stubs/react.ts"), "utf8"),
};

const esbuild = { build } as unknown as EsbuildLike;

const APP = `import { defineApp } from "karta";
export default defineApp({
  id: "todo", name: "Todo", version: "1.0.0", schemaVersion: 1,
  entities: { task: { label: "Task", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Tasks", view: { type: "list", entity: "task", display: { primary: "title" } } }],
});`;

function runIsolateBundle(code: string): { id?: string } {
  const globalThisShim: Record<string, unknown> = {};
  // The IIFE assigns globalThis.__kartaApp — mirror how QuickJS exposes the app to the host.
  new Function("globalThis", code)(globalThisShim);
  return (globalThisShim.__kartaApp as { id?: string }) ?? {};
}

describe("bundleAppSource", () => {
  it("bundles a .app.ts source into an isolate IIFE that yields the KartaApp", async () => {
    const bundled = await bundleAppSource(APP, esbuild, stubs);
    expect(bundled).toContain("__kartaApp");
    expect(runIsolateBundle(bundled).id).toBe("todo");
  });

  it("resolves `karta` to the isolate stub (Zod never enters the bundle)", async () => {
    const bundled = await bundleAppSource(APP, esbuild, stubs);
    expect(bundled.toLowerCase()).not.toContain("zod");
  });
});
