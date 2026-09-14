import { describe, expect, it } from "vitest";
import { defineApp, ValidationError, type AppDefinition, type View } from "../src/index.js";

// A list, gallery or table may group its rows under headings and fold them (#108); a detail section
// or an entity group may fold too. Declarative, so validated: a group naming a field the entity does
// not have is refused by name, and folding with nothing to fold is refused.

const places = (view: Record<string, unknown>): AppDefinition => ({
  id: "places",
  name: "Places",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    place: {
      fields: {
        name: { type: "text", required: true },
        kind: { type: "enum", options: ["restaurant", "bar", "cafe"] },
        visits: { type: "list", of: { on: { type: "datetime" } } },
      },
      groups: [
        { title: "About", fields: ["name", "kind"] },
        { title: "Visits", fields: ["visits"], collapsible: true },
      ],
    },
  },
  pages: [{ id: "all", title: "Places", view: { entity: "place", ...view } as unknown as View }],
});

describe("grouped views", () => {
  it("accepts a field-key group, a function group, and collapsible headings on list, gallery and table", () => {
    expect(() => defineApp(places({ type: "list", group: "kind", collapsible: true }))).not.toThrow();
    expect(() => defineApp(places({ type: "gallery", group: (r: { name: string }) => r.name[0] }))).not.toThrow();
    expect(() => defineApp(places({ type: "table", group: "kind", collapsible: true, display: { columns: ["name"] } }))).not.toThrow();
  });

  it("refuses a group naming a field the entity does not have, by name", () => {
    expect(() => defineApp(places({ type: "list", group: "category" }))).toThrow(ValidationError);
    expect(() => defineApp(places({ type: "list", group: "category" }))).toThrow(/group.*category/);
  });

  it("refuses folding headings that do not exist", () => {
    expect(() => defineApp(places({ type: "list", collapsible: true }))).toThrow(/collapsible.*needs `group`/);
  });

  it("accepts foldable detail sections and entity groups", () => {
    const app = defineApp(
      places({ type: "detail", param: "id", sections: [{ title: "Visits", fields: ["visits"], collapsible: true }, { title: "More", fields: ["kind"], collapsed: true }] }),
    );
    expect(app.entities.place.groups?.[1]?.collapsible).toBe(true);
  });
});
