// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { MemoryStore } from "@karta/store";
import { addStep, newCase } from "@karta/runtime";
import type { EsbuildLike } from "../src/app-bundler.js";

vi.mock("../src/open-store.js", () => ({
  openStore: async (ns: string) => {
    const s = new MemoryStore();
    await s.open(ns);
    return s;
  },
}));

// `createAppBundler` (app-bundler.ts) wires esbuild-WASM's browser build, which throws
// ("The wasmURL option only works in the browser") the moment it is asked to `initialize()`
// outside an actual browser — Vitest runs this file under Node even with `happy-dom` swapping the
// DOM globals, since that only patches globals, not module resolution. `bundleAppSource`, the core
// the factory wraps, is explicitly documented as "env-agnostic (esbuild + stub sources are
// injected), so it's testable in Node with the native esbuild" (app-bundler.ts) — exactly what
// app-bundler.test.ts already does. So here `createAppBundler` is swapped for a same-behavior stub
// built on the real `bundleAppSource` + the real isolate stubs + native `esbuild`, leaving every
// other export (and all of verify-candidate.ts) untouched and real.
vi.mock("../src/app-bundler.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/app-bundler.js")>();
  const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
  const stubs = {
    karta: readFileSync(here("../src/isolate-stubs/karta.ts"), "utf8"),
    react: readFileSync(here("../src/isolate-stubs/react.ts"), "utf8"),
  };
  const esbuild = { build } as unknown as EsbuildLike;
  return {
    ...actual,
    createAppBundler: async () => (source: string) => actual.bundleAppSource(source, esbuild, stubs),
  };
});

const { verifyCandidate } = await import("../src/verify-candidate.js");

const APP = (pages: string) => `import { defineApp } from "karta";
export default defineApp({
  id: "city-maps", name: "City Maps", version: "1.0.0", schemaVersion: 1,
  entities: { city: { label: "City", displayField: "name", fields: { name: { type: "text", required: true } } } },
  pages: [${pages}],
});`;

const LIST = `{ id: "all", title: "Cities", view: { type: "list", entity: "city", display: { primary: "name" } } }`;
const DETAIL = `{ id: "city-detail", title: "City", hidden: true, view: { type: "detail", entity: "city", param: "cityId", sections: [{ fields: ["name"] }] } }`;

const theCase = () => {
  let c = newCase("city-maps", "clicking a city");
  c = addStep(c, { kind: "open", page: "all" });
  c = addStep(c, { kind: "open", page: "city-detail" });
  return c;
};

describe("verifyCandidate", () => {
  it("fails a candidate that still lacks the page the user tapped through to", async () => {
    const v = await verifyCandidate({ source: APP(LIST), theCase: theCase() });
    expect(v.passed).toBe(false);
    expect(v.detail).toContain("city-detail");
  });

  it("passes once the candidate has the page", async () => {
    const v = await verifyCandidate({ source: APP(`${LIST}, ${DETAIL}`), theCase: theCase() });
    expect(v.passed).toBe(true);
  });

  it("fails a candidate that does not compile, without throwing", async () => {
    const v = await verifyCandidate({ source: "this is not typescript {{{", theCase: theCase() });
    expect(v.passed).toBe(false);
    expect(v.detail).toMatch(/could not|compile|parse/i);
  });

  it("kills a candidate whose module body loops forever, on the verification budget", async () => {
    const runaway = `import { defineApp } from "karta";
while (true) {}
export default defineApp({
  id: "city-maps", name: "City Maps", version: "1.0.0", schemaVersion: 1,
  entities: { city: { label: "City", displayField: "name", fields: { name: { type: "text", required: true } } } },
  pages: [${LIST}],
});`;
    const v = await verifyCandidate({ source: runaway, theCase: theCase() });
    expect(v.passed).toBe(false);
  }, 10_000);
});
