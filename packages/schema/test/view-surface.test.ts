import { describe, expect, test } from "vitest";
import { VIEW_FIELDS, structureSchema } from "../src/validate.js";
import { VIEW_TYPES } from "../src/types/app.js";

// VIEW_FIELDS is the boundary the Edit-mode agent is told about: what an app module can declare
// about a view, and therefore where "fix it in the app" stops. It is derived from the Zod schemas
// rather than written out again, because a hand-kept copy would drift and the agent would reason
// confidently from a surface that is no longer enforced.

const page = (view: unknown) => ({
  id: "app",
  name: "App",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { place: { fields: { name: { type: "text" }, loc: { type: "geo" } } } },
  pages: [{ id: "p", title: "P", view }],
});

describe("VIEW_FIELDS", () => {
  // Against VIEW_TYPES rather than a hand-written list: the invariant worth pinning is that the Zod
  // union and the TypeScript union describe the SAME set. A copied list drifts silently the moment a
  // view type is added to one and not the other — which is exactly the failure this file exists to
  // catch, since the Edit-mode agent reasons from whatever VIEW_FIELDS says.
  test("covers every view type the schema accepts", () => {
    expect(Object.keys(VIEW_FIELDS).sort()).toEqual([...VIEW_TYPES].sort());
  });

  test("describes the aggregate view", () => {
    expect(VIEW_FIELDS.aggregate).toContain("entity");
    expect(VIEW_FIELDS.aggregate).toContain("rows"); // required — a fold-less aggregate shows nothing
    expect(VIEW_FIELDS.aggregate).toContain("title?");
    expect(VIEW_FIELDS.aggregate).toContain("emptyText?");
  });

  test("marks optional fields and omits the discriminator", () => {
    expect(VIEW_FIELDS.map).toContain("entity");
    expect(VIEW_FIELDS.map).toContain("geo");
    expect(VIEW_FIELDS.map).toContain("camera?");
    expect(VIEW_FIELDS.map).not.toContain("type");
  });

  test("tracks the schema — a field the schema rejects is not advertised", () => {
    // The guard that matters: everything listed must actually be accepted, or the agent is told it
    // can declare something that will fail validation.
    for (const field of VIEW_FIELDS.map!) {
      expect(field.replace(/\?$/, "")).not.toBe("zoomLevel");
    }
    const bogus = structureSchema.safeParse(page({ type: "map", entity: "place", geo: "loc", zoomLevel: 12 }));
    expect(bogus.success).toBe(false);
  });
});

describe("map camera", () => {
  const map = (camera: unknown) => page({ type: "map", entity: "place", geo: "loc", camera });

  test('accepts "remember" and "fit"', () => {
    expect(structureSchema.safeParse(map("remember")).success).toBe(true);
    expect(structureSchema.safeParse(map("fit")).success).toBe(true);
  });

  test("accepts a fixed center + zoom", () => {
    expect(structureSchema.safeParse(map({ center: [13.4, 52.5], zoom: 12 })).success).toBe(true);
  });

  test("is optional — apps written before it stay valid", () => {
    expect(structureSchema.safeParse(page({ type: "map", entity: "place", geo: "loc" })).success).toBe(true);
  });

  test("rejects a mode it cannot honour", () => {
    expect(structureSchema.safeParse(map("follow-me")).success).toBe(false);
    expect(structureSchema.safeParse(map({ center: [13.4], zoom: 12 })).success).toBe(false);
    expect(structureSchema.safeParse(map({ center: [13.4, 52.5] })).success).toBe(false);
  });
});
