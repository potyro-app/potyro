// M1 sandbox proof + docs/09 parity: run the REAL recipes example both trusted (DirectHost)
// and untrusted (bundled → QuickJS-WASM isolate) and assert identical results. This exercises
// the full dev:sandbox path (esbuild bundle with potyro/react stubbed → isolate) end-to-end.

import { describe, expect, it, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import recipes from "../../../examples/recipes.app.tsx";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import type { NavBridge, UiBridge } from "@potyro/host";
import { compose } from "../src/compose.js";
import { createSandboxLoader } from "../src/isolate-bridge.js";
import { seedIfEmpty } from "../src/seed.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

async function bundleRecipes(): Promise<string> {
  const result = await build({
    entryPoints: [here("../../../examples/recipes.app.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__sandbox",
    platform: "browser",
    target: "es2020",
    footer: { js: "globalThis.__potyroApp = (__sandbox && __sandbox.default) ? __sandbox.default : __sandbox;" },
    alias: {
      potyro: here("../src/isolate-stubs/potyro.ts"),
      react: here("../src/isolate-stubs/react.ts"),
      "react/jsx-runtime": here("../src/isolate-stubs/react.ts"),
      "react/jsx-dev-runtime": here("../src/isolate-stubs/react.ts"),
    },
  });
  return result.outputFiles[0]!.text;
}

function bridges(): { ui: UiBridge; nav: NavBridge } {
  return {
    ui: { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null },
    nav: { navigate: () => {} },
  };
}

async function freshStore(): Promise<MemoryStore> {
  const s = new MemoryStore();
  await s.open("recipes");
  await seedIfEmpty(s);
  return s;
}

let bundleCode: string;
beforeAll(async () => {
  bundleCode = await bundleRecipes();
}, 30000);

describe("sandbox parity — trusted vs untrusted give identical results", () => {
  it("bundles the recipes app to a self-contained IIFE", () => {
    expect(bundleCode).toContain("__potyroApp");
    expect(bundleCode.length).toBeGreaterThan(500);
  });

  it("list page: same names + computed macros in both runners", async () => {
    const { ui, nav } = bridges();

    const trustedStore = await freshStore();
    const trusted = await compose({ app: recipes, provenance: "trusted", store: trustedStore, caps: new FakeCapabilities(), ui, nav });
    const trustedRows = (await trusted.runtime.queryPage("all")).rows;

    const untrustedStore = await freshStore();
    const loadIsolated = await createSandboxLoader(untrustedStore);
    const untrusted = await compose({
      app: recipes,
      provenance: "untrusted",
      bundleCode,
      store: untrustedStore,
      caps: new FakeCapabilities(),
      ui,
      nav,
      loadIsolated,
    });
    const untrustedRows = (await untrusted.runtime.queryPage("all")).rows;

    // same recipes, same order (sorted by name)
    expect(untrustedRows.map((r) => r.name)).toEqual(trustedRows.map((r) => r.name));
    // same computed macros (evaluated in the isolate for the untrusted run)
    for (let i = 0; i < trustedRows.length; i++) {
      expect(Math.round(Number(untrustedRows[i]!.calories))).toBe(Math.round(Number(trustedRows[i]!.calories)));
      expect(Math.round(Number(untrustedRows[i]!.caloriesPerServing))).toBe(
        Math.round(Number(trustedRows[i]!.caloriesPerServing)),
      );
      expect(untrustedRows[i]!.difficulty).toBe(trustedRows[i]!.difficulty);
    }
    untrusted.runtime.core.app.dispose();
  }, 30000);

  it("the cookbook's search and “Can cook now” work the same sealed", async () => {
    const { ui, nav } = bridges();
    const untrustedStore = await freshStore();
    const loadIsolated = await createSandboxLoader(untrustedStore);
    const untrusted = await compose({
      app: recipes,
      provenance: "untrusted",
      bundleCode,
      store: untrustedStore,
      caps: new FakeCapabilities(),
      ui,
      nav,
      loadIsolated,
    });
    const found = (await untrusted.runtime.queryPage("all", { q: "pancake" })).rows.map((r) => r.name);
    expect(found).toEqual(["Fluffy Pancakes"]);
    // Only what the pantry covers, decided by the sealed app's own filter.
    const ready = (await untrusted.runtime.queryPage("all", { ready: true })).rows;
    expect(ready.length).toBeGreaterThan(0);
    expect(ready.every((r) => r.canCook === true)).toBe(true);
    untrusted.runtime.core.app.dispose();
  }, 30000);
});
