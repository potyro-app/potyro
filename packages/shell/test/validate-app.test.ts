// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { defineApp } from "karta";
import { validateDefinition } from "../src/validate-app.js";

// Studio validates the LOADED definition, and `defineApp` copies a layout page's first item into
// `view` so everything downstream sees one view (#105). The schema states the AUTHORING rule — a page
// declares either `view` or `layout` — so checking the loaded object against it reported every app
// with a layout as broken: "Invalid app structure: pages.0.view: a page declares either `view` or
// `layout`", next to a preview of the app running perfectly well.

const withLayout = () =>
  defineApp({
    id: "home", name: "Home", version: "1.0.0", schemaVersion: 1,
    entities: { note: { label: "Note", displayField: "title", fields: { title: { type: "text", required: true } } } },
    pages: [
      {
        id: "today",
        title: "Today",
        layout: {
          type: "grid",
          items: [
            { title: "All", span: 2, view: { type: "list", entity: "note", display: { primary: "title" } } },
            { title: "Count", span: 1, view: { type: "aggregate", entity: "note", rows: (rows) => [{ label: "Notes", value: rows.length }] } },
          ],
        },
      },
      { id: "all", title: "All", view: { type: "list", entity: "note", display: { primary: "title" } } },
    ],
  });

describe("validating a loaded definition", () => {
  it("accepts an app whose page is a layout", () => {
    const app = withLayout();
    // The loaded shape really does carry both — that is what made this fail.
    expect(Object.keys(app.pages[0]!)).toEqual(expect.arrayContaining(["layout", "view"]));
    expect(validateDefinition(app)).toEqual([]);
  });

  it("still accepts an ordinary page", () => {
    expect(validateDefinition(withLayout()).length).toBe(0);
  });

  it("still reports a page that declares neither", () => {
    const broken = { ...withLayout(), pages: [{ id: "empty", title: "Empty" }] };
    expect(validateDefinition(broken).join(" ")).toMatch(/either `view` or `layout`/);
  });

  it("still reports a real structural mistake inside a layout", () => {
    const app = withLayout() as unknown as { pages: Array<{ layout?: { items: Array<{ view: Record<string, unknown> }> } }> };
    app.pages[0]!.layout!.items[0]!.view = { type: "list" }; // no entity
    expect(validateDefinition(app).length).toBeGreaterThan(0);
  });
});
