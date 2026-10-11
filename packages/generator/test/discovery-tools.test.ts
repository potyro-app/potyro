import { describe, expect, it } from "vitest";
import { buildDiscoveryTools, lookupReference } from "../src/agent/discovery-tools.js";
import { buildCorpus } from "../src/corpus.js";
import { regressionGate } from "../src/run-report.js";
import { SCHEMA_REFERENCE } from "../src/reference.generated.js";
import { runTool } from "../src/agent/tools.js";

// Discovery (#131): a developer who does not know whether `camera` takes a function writes it and
// reads the error. These tools give the model the same loop — read the real declaration, check a
// candidate against the real validator — so "this option does not exist" is something it has looked
// up, not something it assumed.

describe("lookupReference", () => {
  it("returns a type by name, with its doc comment", () => {
    const out = lookupReference(SCHEMA_REFERENCE, "MapCamera");
    expect(out).toContain("export type MapCamera");
    expect(out).toMatch(/remember/);
  });

  it("finds the interface that declares a property, and the view interface for a view type", () => {
    expect(lookupReference(SCHEMA_REFERENCE, "camera")).toContain("interface MapView");
    // "map" is a view type: the answer is the MapView declaration and what the validator accepts.
    const map = lookupReference(SCHEMA_REFERENCE, "map");
    expect(map).toContain("interface MapView");
    expect(map).toMatch(/validator accepts.*camera\?/);
  });

  it("finds ctx members and top-level app keys", () => {
    expect(lookupReference(SCHEMA_REFERENCE, "scope")).toContain("interface ScopeDef");
    expect(lookupReference(SCHEMA_REFERENCE, "ctx.scope")).toContain("scope: Readonly<Record<string, Resolved | undefined>>");
  });

  it("says plainly when nothing declares it, so a refusal can quote that", () => {
    const out = lookupReference(SCHEMA_REFERENCE, "initialPosition");
    expect(out).toMatch(/nothing .* declares .*initialPosition/i);
    expect(out).toMatch(/does not exist/i);
  });
});

describe("buildDiscoveryTools", () => {
  const tools = buildDiscoveryTools({ check: async (src) => (src.includes("bad") ? ["pages.0.view: Unrecognized key(s) in object: 'bad'"] : []) });

  it("lookup answers from the reference", async () => {
    const r = await runTool(tools, { id: "1", name: "lookup", args: { query: "FilterChip" } });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("interface FilterChip");
  });

  it("check reports the validator's own words, and ok when there are none", async () => {
    const bad = await runTool(tools, { id: "2", name: "check", args: { source: "bad" } });
    expect(bad.ok).toBe(false);
    expect(bad.detail).toContain("Unrecognized key(s) in object: 'bad'");
    const good = await runTool(tools, { id: "3", name: "check", args: { source: "fine" } });
    expect(good.ok).toBe(true);
    expect(good.detail).toMatch(/validates/i);
  });

  it("check reports a source that does not even compile as a result, not a throw", async () => {
    const throwing = buildDiscoveryTools({ check: async () => { throw new Error("Unexpected token"); } });
    const r = await runTool(throwing, { id: "4", name: "check", args: { source: "x" } });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("Unexpected token");
  });

  it("example returns the few-shot app that uses a feature", async () => {
    const r = await runTool(tools, { id: "5", name: "example", args: { feature: "quickActions" } });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("quickActions");
    const none = await runTool(tools, { id: "6", name: "example", args: { feature: "hologram" } });
    expect(none.ok).toBe(false);
  });

  it("check RUNS a candidate that validates, when it can, and reports what broke (#262)", async () => {
    const running = buildDiscoveryTools({
      check: async () => [],
      run: regressionGate(
        async (src) =>
          src === "ORIGINAL"
            ? { errors: [], warnings: [], ran: "2 pages" }
            : src.includes("boom")
              ? { errors: ["computed recipe.kcal: ctx.nutrition is not a function"], warnings: [], ran: "2 pages" }
              : { errors: [], warnings: ['page "today" showed nothing'], ran: "2 pages" },
        "ORIGINAL",
      ),
    });
    const broken = await runTool(running, { id: "7", name: "check", args: { source: "boom" } });
    expect(broken.ok).toBe(false);
    expect(broken.detail).toContain("ctx.nutrition is not a function");
    const odd = await runTool(running, { id: "8", name: "check", args: { source: "fine" } });
    expect(odd.ok).toBe(true);
    expect(odd.detail).toContain('page "today" showed nothing');
  });

  it("check reports a run that cannot start as a warning, not as a compile error", async () => {
    const running = buildDiscoveryTools({ check: async () => [], run: regressionGate(async () => { throw new Error("no DOM"); }, "ORIGINAL") });
    const r = await runTool(running, { id: "9", name: "check", args: { source: "x" } });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("could not be run to check it: no DOM");
  });
});

describe("corpus tools (#262)", () => {
  const corpus = async () =>
    buildCorpus([
      { path: "apps/piano/piano.app.tsx", text: 'const plan = await ctx.files.read("plan.json");\nexport default defineApp({ id: "piano" });' },
      { path: "docs/04-app-module-api.md", text: "## ctx.files\n\nEvery app owns a folder." },
    ]);
  const tools = buildDiscoveryTools({ check: async () => [], corpus });

  it("search_corpus finds passages with their file", async () => {
    const r = await runTool(tools, { id: "1", name: "search_corpus", args: { query: "ctx.files folder" } });
    expect(r.detail).toContain("docs/04-app-module-api.md:1-");
  });

  it("read returns a file by path", async () => {
    const r = await runTool(tools, { id: "2", name: "read", args: { path: "apps/piano/piano.app.tsx" } });
    expect(r.detail).toContain('defineApp({ id: "piano" })');
  });

  it("example falls back to the corpus when no inline example uses the feature", async () => {
    const r = await runTool(tools, { id: "3", name: "example", args: { feature: "ctx.files.read" } });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("apps/piano/piano.app.tsx");
  });

  it("search_corpus answers from the release's own corpus by default", async () => {
    const real = buildDiscoveryTools({ check: async () => [] });
    const r = await runTool(real, { id: "4", name: "search_corpus", args: { query: "defineApp custom view" } });
    expect(r.detail).toMatch(/--- (examples|apps)\//);
  });
});

describe("corpus tools (#262)", () => {
  const corpus = async () =>
    buildCorpus([
      { path: "apps/piano/piano.app.tsx", text: 'const plan = await ctx.files.read("plan.json");\nexport default defineApp({ id: "piano" });' },
      { path: "docs/04-app-module-api.md", text: "## ctx.files\n\nEvery app owns a folder." },
    ]);
  const tools = buildDiscoveryTools({ check: async () => [], corpus });

  it("search_corpus finds passages with their file", async () => {
    const r = await runTool(tools, { id: "1", name: "search_corpus", args: { query: "ctx.files folder" } });
    expect(r.detail).toContain("docs/04-app-module-api.md:1-");
  });

  it("read returns a file by path", async () => {
    const r = await runTool(tools, { id: "2", name: "read", args: { path: "apps/piano/piano.app.tsx" } });
    expect(r.detail).toContain('defineApp({ id: "piano" })');
  });

  it("example falls back to the corpus when no inline example uses the feature", async () => {
    const r = await runTool(tools, { id: "3", name: "example", args: { feature: "ctx.files.read" } });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("apps/piano/piano.app.tsx");
  });

  it("search_corpus answers from the release's own corpus by default", async () => {
    const real = buildDiscoveryTools({ check: async () => [] });
    const r = await runTool(real, { id: "4", name: "search_corpus", args: { query: "defineApp custom view" } });
    expect(r.detail).toMatch(/--- (examples|apps)\//);
  });
});
