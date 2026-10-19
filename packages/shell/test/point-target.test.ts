// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { AppDefinition } from "potyro";
import { describePoint, pointContext, pointSlice, pointsAt, type PointRef } from "../src/point-target.js";
import { briefSince } from "../src/studio-chat.js";

// Point at the app (#284): a part of the app, said in words and found in the source.

const SOURCE = `import { defineApp } from "potyro";

function Tonight() {
  return (
    <div>
      <h2>Tonight</h2>
      <button type="button">Start the night</button>
    </div>
  );
}

export default defineApp({
  id: "sleep",
  name: "Sleep",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    night: {
      label: "Night",
      displayField: "date",
      fields: {
        date: { type: "datetime", required: true },
        hours: { type: "number", label: "Hours slept" },
      },
    },
  },
  pages: [
    {
      id: "patterns",
      title: "Patterns",
      layout: {
        type: "stack",
        items: [
          { title: "Nights", view: { type: "list", entity: "night" } },
          { view: { type: "chart", entity: "night", series: () => [] } },
        ],
      },
    },
    { id: "tonight", title: "Tonight", view: { type: "custom", entity: "night", render: () => Tonight() } },
  ],
});
`;

const DEF = {
  entities: { night: { label: "Night", fields: { date: { type: "datetime" }, hours: { type: "number", label: "Hours slept" } } } },
  pages: [
    {
      id: "patterns",
      title: "Patterns",
      view: { type: "list", entity: "night" },
      layout: { type: "stack", items: [{ title: "Nights", view: { type: "list", entity: "night" } }, { view: { type: "chart", entity: "night" } }] },
    },
    { id: "tonight", title: "Tonight", view: { type: "custom", entity: "night" } },
  ],
} as unknown as Pick<AppDefinition, "pages" | "entities">;

const lineOf = (needle: string): number => SOURCE.split("\n").findIndex((l) => l.includes(needle)) + 1;

describe("a part, in words", () => {
  const words = (ref: PointRef) => describePoint(ref, DEF);

  it("names a layout item by its title, its kind and its page", () => {
    expect(words({ kind: "view", part: "patterns#0" })).toMatchObject({ label: "“Nights” list", words: 'the "Nights" list on the "Patterns" page' });
  });
  it("names an untitled item by where it is, and what it is", () => {
    expect(words({ kind: "view", part: "patterns#1" }).words).toBe('the second part of the "Patterns" page (a chart)');
  });
  it("names a page's only view by its page", () => {
    expect(words({ kind: "view", part: "tonight" }).words).toBe('the custom view on the "Tonight" page');
    expect(words({ kind: "page", page: "patterns" })).toMatchObject({ label: "“Patterns” page", words: 'the "Patterns" page' });
  });
  it("names a field by its label and its entity, and where it was shown", () => {
    expect(words({ kind: "field", entity: "night", field: "hours", part: "patterns#0" }).words).toBe(
      'the "Hours slept" field of Night, as shown in the "Nights" part of the "Patterns" page',
    );
    expect(words({ kind: "field", entity: "night", field: "date" }).label).toBe("“Date” field");
  });
  it("names a thing in a custom view by its text and what it is", () => {
    expect(words({ kind: "element", part: "tonight", text: "Start the night", tag: "button" }).words).toBe(
      'the "Start the night" button in the custom view on the "Tonight" page',
    );
  });
});

describe("a part, in the source", () => {
  it("is the layout item that declares it, by line — not its neighbour", async () => {
    const slice = await pointSlice(SOURCE, { kind: "view", part: "patterns#0" });
    const at = lineOf('{ title: "Nights"');
    expect(slice).toEqual({ lines: [at, at], excerpt: SOURCE.split("\n")[at - 1] });
  });
  it("is the whole page for a page", async () => {
    const slice = (await pointSlice(SOURCE, { kind: "page", page: "patterns" }))!;
    expect(slice.lines).toEqual([lineOf('id: "patterns"') - 1, lineOf('{ id: "tonight"') - 1]);
    expect(slice.excerpt).toContain("layout:");
    expect(slice.excerpt).not.toContain("tonight");
  });
  it("is the field's declaration for a field", async () => {
    const slice = (await pointSlice(SOURCE, { kind: "field", entity: "night", field: "hours" }))!;
    expect(slice.excerpt.trim()).toBe('hours: { type: "number", label: "Hours slept" },');
  });
  it("is the component around the words, for something in a custom view", async () => {
    const slice = (await pointSlice(SOURCE, { kind: "element", part: "tonight", text: "Start the night", tag: "button" }))!;
    expect(slice.lines).toEqual([lineOf("function Tonight"), lineOf("function Tonight") + 7]);
    expect(slice.excerpt).toContain("<button");
  });
  it("falls back to the view when the words are not written in the app", async () => {
    const slice = (await pointSlice(SOURCE, { kind: "element", part: "tonight", text: "Started 3 times", tag: "text" }))!;
    expect(slice.excerpt).toContain('id: "tonight"');
  });
  it("is nothing for source it cannot read, and the model still gets the words", async () => {
    expect(await pointSlice("not an app (", { kind: "page", page: "x" })).toBeNull();
    const pointed = describePoint({ kind: "page", page: "patterns" }, DEF);
    expect(await pointContext("not an app (", pointed)).toEqual({ pointedAt: { words: 'the "Patterns" page' } });
  });
});

describe("what a tap is in", () => {
  const screen = (html: string): HTMLElement => {
    document.body.innerHTML = html;
    return document.body;
  };

  it("a button in a custom view, then its view", () => {
    screen(`<div data-k-part="tonight" data-k-custom style="display:contents"><div><button id="b"><svg id="i"></svg>Start the night</button></div></div>`);
    expect(pointsAt(document.getElementById("i")!, "tonight")).toEqual([
      { kind: "element", part: "tonight", text: "Start the night", tag: "button" },
      { kind: "view", part: "tonight" },
    ]);
  });
  it("a layout item's title names its view, then its page", () => {
    screen(`<section class="k-layout-item"><h3 id="t">Nights</h3><div data-k-view data-k-part="patterns#0"><p>row</p></div></section>`);
    expect(pointsAt(document.getElementById("t")!, "patterns")).toEqual([
      { kind: "view", part: "patterns#0" },
      { kind: "page", page: "patterns" },
    ]);
  });
  it("a field's label, then the view it is in", () => {
    screen(`<div data-k-view data-k-part="patterns#0"><label data-k-field="night.hours"><span id="l">Hours slept</span></label></div>`);
    expect(pointsAt(document.getElementById("l")!, "patterns")[0]).toEqual({ kind: "field", entity: "night", field: "hours", part: "patterns#0" });
  });
  it("a tab — its icon too — is its page; the app's own bar is the page on screen", () => {
    screen(`<nav><button class="k-tab"><span id="icon">☰</span><span data-k-page="tonight">Tonight</span></button></nav><header><span id="bar">x</span></header>`);
    expect(pointsAt(document.getElementById("icon")!, "patterns")).toEqual([{ kind: "page", page: "tonight" }]);
    expect(pointsAt(document.getElementById("bar")!, "patterns")).toEqual([{ kind: "page", page: "patterns" }]);
  });
  it("nothing in what the shell draws", () => {
    screen(`<div class="k-tools"><button id="s">Studio</button></div>`);
    expect(pointsAt(document.getElementById("s")!, "patterns")).toEqual([]);
  });
});

describe("the brief", () => {
  it("says what a pointed message was about, beside what was said", () => {
    expect(briefSince([{ kind: "ask", text: "call it Every night", point: { label: "“Nights” list", words: 'the "Nights" list on the "Patterns" page' } }])).toBe(
      'About the "Nights" list on the "Patterns" page: call it Every night',
    );
  });
});

// A translated app (#302): pointing at a label written as a map says it in the person's language,
// and the slice is the field's own lines — the map, every language of it.
describe("pointing at a translated label", () => {
  it("names it in the language shown, or the app's own for a raw definition, and slices the map", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { localize } = await import("potyro");
    // Groceries as it was with inline maps (docs/20): pointing at a map slices it per language.
    const source = readFileSync(resolve(process.cwd(), "../generator/test/fixtures/legacy-examples/groceries.app.ts"), "utf8");
    const raw = (await import("../../generator/test/fixtures/legacy-examples/groceries.app.js")).default as unknown as AppDefinition;
    const ref: PointRef = { kind: "field", entity: "item", field: "quantity", part: "shopping" };
    expect(describePoint(ref, localize(raw, "pl") as AppDefinition).words).toBe('the "Ilość" field of Produkt, as shown in the checklist on the "Lista" page');
    expect(describePoint(ref, raw).words).toBe('the "Quantity" field of Item, as shown in the checklist on the "List" page');
    const slice = (await pointSlice(source, ref))!;
    expect(slice.excerpt).toContain('label: { en: "Quantity", "pt-BR": "Quantidade", de: "Menge", es: "Cantidad", pl: "Ilość", it: "Quantità" }');
    expect(slice.excerpt).toContain('en: "How much, in your own words",');
    expect(slice.excerpt).toContain('pl: "Ile — własnymi słowami",');
  });
});
