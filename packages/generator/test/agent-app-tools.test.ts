import { describe, expect, it } from "vitest";
import { addStep, annotate, newCase } from "@karta/runtime";
import { buildAppTools, type InvestigationDeps } from "../src/agent/app-tools.js";
import { runTool } from "../src/agent/tools.js";

function deps(over: Partial<InvestigationDeps> = {}): InvestigationDeps {
  let c = newCase("city-maps", "clicking a city");
  c = addStep(c, { kind: "open", page: "all" });
  c = annotate(c, "here I expected the map to open");
  c = addStep(c, { kind: "open", page: "city-detail" });
  return {
    source: 'import { defineApp } from "karta";\nexport default defineApp({ id: "city-maps" });',
    theCase: c,
    target: {
      definition: { pages: [{ id: "all", title: "Cities", view: { type: "list", entity: "city" } }] },
      query: async () => [{ id: "c1", name: "Lisbon", location: null }],
    },
    records: async () => [
      { id: "c1", name: "Lisbon", location: null },
      { id: "c2", name: "Porto", location: { lat: 41, lng: -8 } },
    ],
    allowRawRecords: false,
    ...over,
  };
}

const call = (name: string, args: Record<string, unknown> = {}) => ({ id: "x", name, args });

describe("investigation tools", () => {
  it("replay_case reports the step that goes nowhere", async () => {
    const r = await runTool(buildAppTools(deps()), call("replay_case"));
    expect(r.ok).toBe(false); // the replay did not pass
    expect(r.detail).toContain('no page "city-detail"');
    expect(r.detail).toContain("here I expected the map to open");
  });

  it("inspect_app lists the pages that actually exist", async () => {
    const r = await runTool(buildAppTools(deps()), call("inspect_app"));
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("all");
    expect(r.detail).toContain("list");
  });

  // Privacy: the point of this tool is "42 cities, 0 with a location", not the user's data.
  it("query_data returns shapes and counts, never the records themselves", async () => {
    const r = await runTool(buildAppTools(deps()), call("query_data", { entity: "city" }));
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/2 records/);
    expect(r.detail).toMatch(/location/);
    expect(r.detail).toMatch(/1 empty/); // Lisbon has no location — the likely cause of an empty map
    expect(r.detail).not.toContain("Lisbon");
    expect(r.detail).not.toContain("Porto");
  });

  it("query_data returns values only when raw access was explicitly granted", async () => {
    const r = await runTool(buildAppTools(deps({ allowRawRecords: true })), call("query_data", { entity: "city" }));
    expect(r.detail).toContain("Lisbon");
  });

  // Finding 1: the tool schema is sent to the model up front, before any call happens. If it says
  // "counts only" while allowRawRecords is true, the model is told its input is pre-sanitized and
  // will treat raw personal data as safe to echo — the privacy boundary failing in the worst direction.
  it("query_data's description promises counts-only when raw access is off", () => {
    const tools = buildAppTools(deps({ allowRawRecords: false }));
    const spec = tools.find((t) => t.name === "query_data")!;
    expect(spec.description).toMatch(/counts only|never.*values/i);
    expect(spec.description).not.toMatch(/actual records|real records/i);
  });

  it("query_data's description admits real records are returned when raw access is on", () => {
    const tools = buildAppTools(deps({ allowRawRecords: true }));
    const spec = tools.find((t) => t.name === "query_data")!;
    expect(spec.description).not.toMatch(/counts only|never.*values/i);
    expect(spec.description).toMatch(/actual|real/i);
    expect(spec.description).toMatch(/personal/i);
  });

  // Finding 3: shapeOf must treat `false` and `0` as SET, not empty. A naive `!v` check would
  // report both as empty, sending the agent chasing a data problem that does not exist. This is
  // the test that a regression from `v === null || v === undefined || v === ""` to `!v` would fail:
  // `!false` and `!0` are both true, so a `!v`-based shapeOf would count these as empty.
  it("query_data counts false and 0 as set, not empty (guards against a naive falsy check)", async () => {
    const r = await runTool(
      buildAppTools(
        deps({
          records: async () => [
            { id: "r1", active: false, count: 0 },
            { id: "r2", active: true, count: 5 },
          ],
        }),
      ),
      call("query_data", { entity: "widget" }),
    );
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/active: 2 set, 0 empty/);
    expect(r.detail).toMatch(/count: 2 set, 0 empty/);
  });

  it("query_data counts a key present on only some rows correctly", async () => {
    const r = await runTool(
      buildAppTools(
        deps({
          records: async () => [
            { id: "r1", name: "only-in-first" },
            { id: "r2" },
          ],
        }),
      ),
      call("query_data", { entity: "widget" }),
    );
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/name: 1 set, 1 empty/);
  });

  it("query_data reports 0 records for an entity with no records at all", async () => {
    const r = await runTool(buildAppTools(deps({ records: async () => [] })), call("query_data", { entity: "widget" }));
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/0 records/);
  });

  // Finding 2: a character-offset slice can sever a JSON value mid-string, and the model has no
  // way to tell "all records" from "a fragment of the last one". Truncation must land on a row
  // boundary and must always state totals, so the model can trust what it has.
  describe("raw mode truncation", () => {
    const manyRows = Array.from({ length: 200 }, (_, i) => ({
      id: `r${i}`,
      note: "x".repeat(200),
    }));

    it("returns valid, parseable JSON even when truncated", async () => {
      const r = await runTool(
        buildAppTools(deps({ allowRawRecords: true, records: async () => manyRows })),
        call("query_data", { entity: "widget" }),
      );
      expect(r.ok).toBe(true);
      const jsonMatch = r.detail.match(/\[[\s\S]*\]/);
      expect(jsonMatch).not.toBeNull();
      expect(() => JSON.parse(jsonMatch![0])).not.toThrow();
    });

    it("states totals when rows were dropped", async () => {
      const r = await runTool(
        buildAppTools(deps({ allowRawRecords: true, records: async () => manyRows })),
        call("query_data", { entity: "widget" }),
      );
      expect(r.detail).toMatch(/showing \d+ of 200/);
    });

    it("states nothing was dropped when everything fits", async () => {
      const smallRows = [{ id: "r1", name: "Lisbon" }, { id: "r2", name: "Porto" }];
      const r = await runTool(
        buildAppTools(deps({ allowRawRecords: true, records: async () => smallRows })),
        call("query_data", { entity: "widget" }),
      );
      expect(r.detail).toMatch(/showing 2 of 2/);
    });
  });
});
