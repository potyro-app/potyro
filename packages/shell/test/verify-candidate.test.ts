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

  it("passes once the candidate has the page, and reports the real record count", async () => {
    // Finding 5 (security review, KA-38 follow-on): this test was meant to cover a shape bug where
    // `runtime.queryPage()` returns `{ rows, ctx }` rather than a bare array — verify-candidate.ts's
    // `query` unwraps `.rows` deliberately. But an empty, unseeded store made that bug invisible:
    // `rows.length` on the wrong shape is `undefined`, not a throw, so `replayCase` still reports
    // `ok: true` with "undefined records" and `passed` stays `true` either way. Seeding a record and
    // asserting the real count in `detail` is what makes wiring `query` to the wrong shape fail here.
    const store = new MemoryStore();
    await store.open("city-maps-verify");
    await store.insert("city", { name: "Springfield" });
    const v = await verifyCandidate({ source: APP(`${LIST}, ${DETAIL}`), theCase: theCase(), store });
    expect(v.passed).toBe(true);
    expect(v.detail).toContain("1 records");
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
    const start = Date.now();
    const v = await verifyCandidate({ source: runaway, theCase: theCase() });
    const elapsedMs = Date.now() - start;
    expect(v.passed).toBe(false);
    // Finding 6 (security review, KA-38 follow-on): `passed === false` alone would also be green if
    // the runaway simply stopped compiling — that is a different failure mode this test is not
    // about, and the earlier "does not compile" test already covers it. Rule that out explicitly...
    expect(v.detail).not.toMatch(/could not compile/i);
    // ...and bound the elapsed time to roughly the verification budget window (VERIFY_TIMEOUT_MS =
    // 5s): under ~8s catches a hang that would otherwise only be caught by this test's own 10s
    // timeout (reading as a flaky timeout, not a clear assertion failure), and over ~1s catches an
    // instant failure — e.g. a candidate rejected for some unrelated reason before the interrupt
    // handler ever got a chance to trip — which would otherwise read as "the timeout worked".
    expect(elapsedMs).toBeGreaterThan(1_000);
    expect(elapsedMs).toBeLessThan(8_000);
  }, 10_000);
});
