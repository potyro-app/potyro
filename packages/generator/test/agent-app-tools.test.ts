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
});
