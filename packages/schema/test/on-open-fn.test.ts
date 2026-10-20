// A view's tap as the app's own function (docs/04): `onOpen` is the page to go to, as data, OR a
// function of the record and ctx; the map view's `onSelect` is always the app's function. Logic is
// typed, not validated (CLAUDE.md rule 4): the structure schema accepts a function where it accepts
// the data form, and still refuses what is neither.

import { describe, expect, it } from "vitest";
import { defineApp, structureSchema, type Ctx, type Resolved } from "../src/index.js";

const base = {
  id: "spots",
  name: "Spots",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { spot: { label: "Spot", fields: { name: { type: "text" }, at: { type: "geo" } } } },
} as const;

describe("a view's onOpen and the map's onSelect", () => {
  it("accepts onOpen as data or as a function, on every view that opens rows", () => {
    const app = defineApp({
      ...base,
      pages: [
        { id: "list", title: "List", view: { type: "list", entity: "spot", onOpen: { page: "one", param: { spotId: "id" } } } },
        { id: "gallery", title: "Gallery", view: { type: "gallery", entity: "spot", onOpen: (r: Resolved, ctx: Ctx) => ctx.ui.toast(String(r.name)) } },
        { id: "map", title: "Map", view: { type: "map", entity: "spot", geo: "at", onOpen: async (r: Resolved, ctx: Ctx) => void (await ctx.views.map("map").select(r.id)) } },
        { id: "one", title: "One", view: { type: "detail", entity: "spot", param: "spotId" } },
      ],
    } as never);
    expect(structureSchema.safeParse(app).success).toBe(true);
  });

  it("accepts the map's onSelect as a function, and nothing else", () => {
    const ok = defineApp({ ...base, pages: [{ id: "map", title: "Map", view: { type: "map", entity: "spot", geo: "at", onSelect: (r: Resolved, ctx: Ctx) => ctx.views.map("map").select(r.id) } }] } as never);
    expect(structureSchema.safeParse(ok).success).toBe(true);
    const bad = { ...base, pages: [{ id: "map", title: "Map", view: { type: "map", entity: "spot", geo: "at", onSelect: { page: "one" } } }] };
    expect(structureSchema.safeParse(bad).success).toBe(false);
  });

  it("still refuses an onOpen that is neither a page nor a function", () => {
    const bad = { ...base, pages: [{ id: "list", title: "List", view: { type: "list", entity: "spot", onOpen: "one" } }] };
    expect(structureSchema.safeParse(bad).success).toBe(false);
  });
});
