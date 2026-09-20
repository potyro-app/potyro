import { describe, expect, it } from "vitest";
import { defineApp, ValidationError, PAGE_FIELDS, type AppInput, type Ctx } from "../src/index.js";

// A page's own buttons (#216).
//
// Until now the only app code a view could run needed a record — a row action, or a detail page's
// actions — so there was no way to declare "a button on this page that does something", and no way
// at all to put one on a map, a table or a board. That, with a map camera that is only read when the
// view opens, is why "add a small button that centres the map on my location" came back from the
// generator as something the platform could not do.

const base = (pages: AppInput["pages"]): AppInput => ({
  id: "places",
  name: "Places",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { place: { fields: { name: { type: "text" }, at: { type: "geo" } } } },
  pages,
});

const map = { type: "map", entity: "place", geo: "at" } as const;

describe("page actions", () => {
  it("keeps the app's label, icon and function", () => {
    const run = async (ctx: Ctx): Promise<void> => void (await ctx.views.map("map").fit());
    const app = defineApp(base([{ id: "map", title: "Map", actions: [{ label: "Show all", icon: "⤢", run }], view: map }]));

    const action = app.pages[0]!.actions?.[0];
    expect(action?.label).toBe("Show all");
    expect(action?.icon).toBe("⤢");
    // The function survives validation as a function — the whole point of "logic is real TS, not a
    // DSL": what a button does is code, never a string the host interprets.
    expect(typeof action?.run).toBe("function");
  });

  it("is available on every kind of page, not only the ones that had actions before", () => {
    // A map and a board could not run app code at all. This is the change that matters for them.
    const pages: AppInput["pages"] = [
      { id: "map", title: "Map", actions: [{ label: "Show all", run: () => {} }], view: map },
      { id: "table", title: "Table", actions: [{ label: "Tidy", run: () => {} }], view: { type: "table", entity: "place" } },
      { id: "all", title: "All", actions: [{ label: "Sort", run: () => {} }], view: { type: "list", entity: "place" } },
    ];
    expect(() => defineApp(base(pages))).not.toThrow();
  });

  it("insists on a label, because a button nobody can read is not a button", () => {
    expect(() => defineApp(base([{ id: "map", title: "Map", actions: [{ run: () => {} } as never], view: map }]))).toThrow(ValidationError);
    expect(() => defineApp(base([{ id: "map", title: "Map", actions: [{ label: "", run: () => {} }], view: map }]))).toThrow(ValidationError);
  });

  it("insists on something to run", () => {
    expect(() => defineApp(base([{ id: "map", title: "Map", actions: [{ label: "Show all" } as never], view: map }]))).toThrow(ValidationError);
    // A string is what an action KEY would be; a page action is the function itself.
    expect(() => defineApp(base([{ id: "map", title: "Map", actions: [{ label: "Show all", run: "showAll" } as never], view: map }]))).toThrow(
      ValidationError,
    );
  });

  it("is a page field the editing agent knows about", () => {
    // PAGE_FIELDS is handed to the model that edits apps; a field missing from it is a field it will
    // not use — which is how a capability ships and stays invisible.
    expect(PAGE_FIELDS).toContain("actions?");
  });
});
