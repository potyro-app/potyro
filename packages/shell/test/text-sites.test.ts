// @vitest-environment happy-dom
//
// Edit mode's source side: which pieces of text an app shows are literals we can splice, and the
// splice itself.
//
// The rule is positional, not textual. A string is offered only where it sits in a place that is
// about DISPLAY — a `label`, a `title`, JSX text, a display prop — because the same characters in
// `status === "done"` or `view: { title: "name" }` are data and logic, and renaming those would break
// the app while looking like a copy edit.

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyEdit, fieldStep, inspect, resetSourceTools, textSites, type Edit } from "../src/app-source.js";

const read = (name: string): string => readFileSync(resolve(process.cwd(), "../../examples", name), "utf8");
const RECIPES = read("recipes.app.tsx");

const APP = `import { defineApp } from "potyro";

function Board({ ctx }) {
  const done = ctx.params.done;
  return (
    <div className="board">
      <h2>Today&apos;s plan</h2>
      <p>
        Nothing planned yet,
        take a break.
      </p>
      <button title="Start the timer" className={"primary"} onClick={() => ctx.nav("run")}>
        Start session
      </button>
      <span>{done ? "All done" : 'Keep going'}</span>
      <input placeholder={\`Search\`} />
    </div>
  );
}

export default defineApp({
  id: "kit",
  name: "Kit",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      label: "Item",
      fields: {
        title: { type: "text", required: true },
        status: { type: "enum", options: ["open", "done"] },
      },
      computed: { isDone: (r) => r.status === "done" },
    },
  },
  pages: [
    { id: "all", title: "Everything", view: { type: "map", entity: "item", geo: "where", title: "title" } },
    { id: "board", title: "Board", view: { type: "custom", component: Board } },
    { id: "one", title: "Item", hidden: true, view: { type: "detail", entity: "item" } },
  ],
});
`;

const apply = async (source: string, edit: Edit): Promise<string> => {
  const result = await applyEdit(source, edit);
  if (!result.ok) throw new Error(`edit refused: ${result.reason}`);
  return result.source;
};

beforeEach(resetSourceTools);

describe("textSites", () => {
  it("offers display literals from the definition and from JSX", async () => {
    const texts = (await textSites(APP)).map((s) => s.text);
    expect(texts).toEqual(
      expect.arrayContaining(["Item", "Everything", "Board", "Kit", "Nothing planned yet, take a break.", "Start session", "All done", "Keep going"]),
    );
  });

  it("does not offer what is never text on screen: placeholders, tooltips, alt text", async () => {
    // A record named "Milk" must not pair with `placeholder: "Milk"` (Groceries did exactly that).
    const texts = (await textSites(APP.replace(`title: { type: "text", required: true },`, `title: { type: "text", required: true, placeholder: "Milk" },`))).map((s) => s.text);
    for (const t of ["Milk", "Start the timer", "Search"]) expect(texts).not.toContain(t);
  });

  it("offers a display prop of the app's own component", async () => {
    const texts = (await textSites(APP.replace("<h2>Today&apos;s plan</h2>", `<Card title="Today" />`))).map((s) => s.text);
    expect(texts).toContain("Today");
  });

  it("does not offer strings that are data or logic", async () => {
    const texts = (await textSites(APP)).map((s) => s.text);
    // enum values, a comparison, a field key used as a map title, ids, classes, nav targets
    for (const t of ["open", "done", "title", "kit", "all", "primary", "run", "board", "text", "enum"]) expect(texts).not.toContain(t);
  });

  it("skips JSX text it can't reproduce exactly (entities)", async () => {
    expect((await textSites(APP)).map((s) => s.text)).not.toContain("Today's plan");
  });

  it("points each site at the literal in the source", async () => {
    for (const site of await textSites(APP)) {
      const raw = APP.slice(site.start, site.end);
      if (site.form === "jsx") expect(raw.replace(/\s+/g, " ")).toBe(site.text);
      else expect(raw.slice(1, -1)).toBe(site.text);
    }
  });

  it("reads the real Recipes app, custom view included", async () => {
    const texts = (await textSites(RECIPES)).map((s) => s.text);
    expect(texts).toEqual(expect.arrayContaining(["Recipe not found.", "Overview", "Can cook now", "Price per kg"]));
  });

  it("is empty, not an error, for source it can't parse", async () => {
    expect(await textSites("this is not { valid ts")).toEqual([]);
  });
});

describe("text edit", () => {
  const siteOf = async (source: string, text: string) => (await textSites(source)).filter((s) => s.text === text);

  it("replaces a string literal, keeping its quote style", async () => {
    const next = await apply(APP, { kind: "text", from: "Keep going", sites: await siteOf(APP, "Keep going"), value: "Don't stop" });
    expect(next).toContain(`'Don\\'t stop'`);
    expect(next.replace(`'Don\\'t stop'`, `'Keep going'`)).toBe(APP);
  });

  it("replaces multi-line JSX text with one line", async () => {
    const from = "Nothing planned yet, take a break.";
    const next = await apply(APP, { kind: "text", from, sites: await siteOf(APP, from), value: "Free day" });
    expect(next).toMatch(/<p>\s+Free day\s+<\/p>/);
  });

  it("wraps JSX text that would otherwise be read as markup", async () => {
    const next = await apply(APP, { kind: "text", from: "Start session", sites: await siteOf(APP, "Start session"), value: "Go {now} <3" });
    expect(next).toContain(`{"Go {now} <3"}`);
  });

  it("changes every place a repeated text is written", async () => {
    const twice = APP.replace(`title: "Board"`, `title: "Everything"`);
    const sites = await siteOf(twice, "Everything");
    expect(sites).toHaveLength(2);
    const next = await apply(twice, { kind: "text", from: "Everything", sites, value: "All" });
    expect(next.match(/"All"/g)).toHaveLength(2);
  });

  it("refuses when the source moved under it, rather than splicing the wrong bytes", async () => {
    const sites = await siteOf(APP, "Board");
    const shifted = `// a comment\n${APP}`;
    expect((await applyEdit(shifted, { kind: "text", from: "Board", sites, value: "X" })).ok).toBe(false);
  });

  it("refuses to empty a text", async () => {
    expect((await applyEdit(APP, { kind: "text", from: "Board", sites: await siteOf(APP, "Board"), value: "  " })).ok).toBe(false);
  });
});

describe("inspect: written, but not as a literal", () => {
  it("marks a computed page title and field label, so nothing overwrites them", async () => {
    const shape = await inspect(APP.replace(`title: "Board"`, `title: String("Board")`).replace(`label: "Item",`, `label: "Item",`).replace(
      `title: { type: "text", required: true },`,
      `title: { type: "text", required: true, label: ["Ti", "tle"].join("") },`,
    ));
    expect(shape.pages.find((p) => p.id === "board")).toMatchObject({ titleOpaque: true });
    expect(shape.pages.find((p) => p.id === "all")?.titleOpaque).toBeUndefined();
    expect(shape.entities[0]!.fields.find((f) => f.key === "title")).toMatchObject({ labelOpaque: true });
  });
});

describe("page order", () => {
  it("moves a page and keeps each page's text intact", async () => {
    const next = await apply(APP, { kind: "page-order", order: ["board", "all", "one"] });
    expect((await inspect(next)).pages.map((p) => p.id)).toEqual(["board", "all", "one"]);
    expect(next.length).toBe(APP.length);
  });

  it("keeps a same-line comment with the page it is written after", async () => {
    // Babel hands `}, // x` to the NEXT page as a leading comment; moving pages must not re-home it.
    const commented = APP.replace(
      `view: { type: "map", entity: "item", geo: "where", title: "title" } },`,
      `view: { type: "map", entity: "item", geo: "where", title: "title" } }, // the main list`,
    ).replace(`view: { type: "custom", component: Board } },`, `view: { type: "custom", component: Board } }, /* the board */`);
    const next = await apply(commented, { kind: "page-order", order: ["board", "one", "all"] });
    expect(next).toMatch(/id: "board".*}, \/\* the board \*\/\n/);
    expect(next).toMatch(/id: "all".*}, \/\/ the main list\n/);
    expect((await inspect(next)).pages.map((p) => p.id)).toEqual(["board", "one", "all"]);
  });

  it("keeps a same-line comment with the field it is written after", async () => {
    const commented = APP.replace(`title: { type: "text", required: true },`, `title: { type: "text", required: true }, // what it's called`);
    const next = await apply(commented, { kind: "field-order", entity: "item", order: ["status", "title"] });
    expect(next).toMatch(/status: \{[^\n]*\},\n\s+title: \{[^\n]*\}, \/\/ what it's called\n/);
  });

  it("refuses an order that isn't the same pages", async () => {
    expect((await applyEdit(APP, { kind: "page-order", order: ["board", "all"] })).ok).toBe(false);
  });
});

describe("fieldStep", () => {
  it("moves a field within an entity, and stops at the ends", async () => {
    const entity = (await inspect(APP)).entities[0]!;
    expect(fieldStep(entity, "status", -1)).toEqual({ kind: "field-order", entity: "item", order: ["status", "title"] });
    expect(fieldStep(entity, "title", -1)).toBeNull();
  });

  it("moves across a group's edge in a grouped entity", async () => {
    const recipe = (await inspect(RECIPES)).entities.find((e) => e.key === "recipe")!;
    const first = recipe.groups![3]!.fields[0]!;
    const edit = fieldStep(recipe, first, -1);
    expect(edit?.kind).toBe("field-groups");
    const groups = (edit as { groups: string[][] }).groups;
    expect(groups[2]).toContain(first);
    expect(groups[3]).not.toContain(first);
  });
});
