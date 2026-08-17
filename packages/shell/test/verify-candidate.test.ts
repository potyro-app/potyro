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

const { verifyCandidate, VERIFY_TIMEOUT_MS } = await import("../src/verify-candidate.js");

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

  it("fails (rather than hangs) when a candidate's filter awaits something verification can never answer", async () => {
    // Finding 1 (security review, KA-38 follow-on): the isolate's own interrupt handler bounds CPU
    // running INSIDE QuickJS — module load, each invoke() call — but cannot bound a host promise the
    // isolate is merely AWAITING. ctx.ui.pick() is the realistic way a candidate hits this class:
    // verify-candidate.ts now supplies no PickerHost (see the "No picker" comment there), so
    // ctx.ui.pick() resolves to `null` immediately via ui-bridge.ts's headless fallback — safe. This
    // candidate calls ctx.ui.pick() anyway, so the test exercises the real call site, but @karta/host's
    // isolate bridge does not implement a `ui.pick` host op today (a separate gap in the host package,
    // out of scope for this shell-only fix) — so that call currently rejects fast rather than hanging.
    // The `await new Promise(() => {})` after it reproduces the hazard directly instead: from the
    // isolate's point of view, a promise that genuinely never settles is indistinguishable from a
    // `PickerHost.pick()` that nobody ever mounted a React tree to resolve — either way QuickJS sits
    // idle waiting on a host promise, so its CPU-bound interrupt handler never gets a chance to fire.
    // Verified directly against @karta/host's real isolate during development: without a wall clock
    // around the whole verification, this hangs indefinitely (still unsettled 6s in, on a 2s per-call
    // budget) — proving the per-call `timeoutMs` alone does not save `verifyCandidate` here.
    // The filter only runs per resolved row — an unseeded store would let this "pass" instantly with
    // zero records and the filter never even called, which would prove nothing. Seed one, as the
    // "reports the real record count" test above does for the same reason.
    const HANGING_FILTER = `{ id: "all", title: "Cities", view: { type: "list", entity: "city", filter: async (r, ctx) => { try { await ctx.ui.pick(["a", "b"]); } catch (e) {} await new Promise(() => {}); return true; }, display: { primary: "name" } } }`;
    let c = newCase("city-maps", "opening a list whose filter never returns");
    c = addStep(c, { kind: "open", page: "all" });
    const store = new MemoryStore();
    await store.open("city-maps-hang");
    await store.insert("city", { name: "Springfield" });

    const start = Date.now();
    const v = await verifyCandidate({ source: APP(HANGING_FILTER), theCase: c, store });
    const elapsedMs = Date.now() - start;

    expect(v.passed).toBe(false);
    expect(v.detail).toMatch(/timed out/i);
    // Bounded by the wall clock (VERIFY_WALL_CLOCK_MS = VERIFY_TIMEOUT_MS * 2 in verify-candidate.ts),
    // not by the isolate's own per-call budget: this candidate's promise never settles on its own, so
    // an elapsed time near VERIFY_TIMEOUT_MS alone would prove nothing about the OUTER race this test
    // exists to cover — remove that race and this assertion (and the "not hang" premise) both fail,
    // this time by the test's own 15s timeout instead of a clean, fast, readable assertion failure.
    expect(elapsedMs).toBeGreaterThan(VERIFY_TIMEOUT_MS);
    expect(elapsedMs).toBeLessThan(VERIFY_TIMEOUT_MS * 2 + 2_000);
  }, 15_000);
});
