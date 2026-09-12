import { describe, expect, it } from "vitest";
import { defineApp, resolveView, basePageId, layoutItemId, ValidationError, PAGE_FIELDS, type AppInput } from "../src/index.js";

// Page layouts (#105): a page declares `view` or `layout`; `defineApp` fills `view` from a
// layout's first item; every item is validated like a page's view and is addressable as
// `page#index`; a split is a list and a detail, tabs name their items.

const base = (pages: AppInput["pages"]): AppInput => ({
  id: "plants",
  name: "Plants",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { plant: { fields: { name: { type: "text" }, due: { type: "datetime" } }, computed: { overdue: () => false } } },
  pages,
});

const list = { type: "list", entity: "plant" } as const;
const detail = { type: "detail", entity: "plant", param: "plantId" } as const;

describe("page layout", () => {
  it("fills the page's view from the first item and keeps the layout", () => {
    const app = defineApp(base([{ id: "today", title: "Today", layout: { type: "grid", items: [{ title: "Due", span: 1, view: list }, { view: { type: "calendar", entity: "plant", date: "due" } }] } }]));
    const page = app.pages[0]!;
    expect(page.view).toEqual(list);
    expect(page.layout?.items).toHaveLength(2);
    expect(resolveView(app, "today")).toEqual(list);
    expect(resolveView(app, layoutItemId("today", 1)).type).toBe("calendar");
    expect(basePageId("today#1")).toBe("today");
    expect(() => resolveView(app, "today#5")).toThrow(/no layout item 5/);
  });

  it("refuses a page with both or neither", () => {
    expect(() => defineApp(base([{ id: "p", title: "P" } as never]))).toThrow(/either `view` or `layout`/);
    expect(() => defineApp(base([{ id: "p", title: "P", view: list, layout: { type: "stack", items: [{ view: list }] } } as never]))).toThrow(/either `view` or `layout`/);
  });

  it("validates every item's view, naming the item", () => {
    expect(() => defineApp(base([{ id: "p", title: "P", layout: { type: "stack", items: [{ title: "Bad", view: { type: "list", entity: "tree" } }] } }]))).toThrow(
      /page "p" layout item 1 \("Bad"\) references unknown entity "tree"/,
    );
  });

  it("a split is a list and a detail; tabs name their items", () => {
    expect(() => defineApp(base([{ id: "p", title: "P", layout: { type: "split", items: [{ view: list }] } }]))).toThrow(/exactly two items/);
    expect(() => defineApp(base([{ id: "p", title: "P", layout: { type: "split", items: [{ view: list }, { view: list }] } }]))).toThrow(/second item is the detail/);
    expect(() => defineApp(base([{ id: "p", title: "P", layout: { type: "split", items: [{ view: list }, { view: detail }] } }]))).not.toThrow();
    expect(() => defineApp(base([{ id: "p", title: "P", layout: { type: "tabs", items: [{ view: list }, { title: "Done", view: list }] } }]))).toThrow(/its title is the tab/);
  });

  it("is part of what a page may declare", () => {
    expect(PAGE_FIELDS).toContain("layout?");
    expect(() => defineApp(base([{ id: "p", title: "P", layout: { type: "grid", items: [{ view: list, colour: "red" } as never] } }]))).toThrow(ValidationError);
  });
});
