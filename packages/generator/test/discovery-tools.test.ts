import { describe, expect, it } from "vitest";
import { buildDiscoveryTools, lookupReference } from "../src/agent/discovery-tools.js";
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
});
