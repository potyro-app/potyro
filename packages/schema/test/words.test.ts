// Multi-language apps (#302, docs/20): the `Words` slots, the checks, and resolution.

import { describe, expect, test } from "vitest";
import { defineApp } from "../src/defineApp.js";
import { checkWords, localize, pickLanguage, word, wordGaps, wordSlots, wordsPathText } from "../src/words.js";
import type { AppInput } from "../src/types/app.js";

const en = (s: string, pl: string) => ({ en: s, pl });

/** Every slot of docs/20 §1.2, as a map — the test that the walker finds the whole list. */
function everySlot(): AppInput {
  return {
    id: "all-slots",
    name: en("Shopping", "Zakupy"),
    version: "1.0.0",
    schemaVersion: 1,
    language: "en",
    languages: ["en", "pl"],
    scope: { entity: "trip", label: en("Trip", "Wyjazd") },
    quickActions: [{ id: "qa", label: en("Add item", "Dodaj produkt"), entity: "item" }],
    entities: {
      trip: { label: en("Trip", "Wyjazd"), fields: { name: { type: "text" } } },
      item: {
        label: en("Item", "Produkt"),
        fields: {
          name: { type: "text", label: en("Name", "Nazwa"), help: en("What it is", "Co to jest"), placeholder: en("Milk", "Mleko") },
          qty: { type: "number", unit: en("pieces", "sztuk") },
          kind: { type: "enum", options: ["produce", "dairy"], labels: { produce: en("Produce", "Warzywa"), dairy: en("Dairy", "Nabiał") } },
          tags: { type: "tags", options: ["cold"], labels: { cold: en("Cold", "Zimne") } },
          parts: { type: "list", of: { part: { type: "text", label: en("Part", "Część") } } },
          got: { type: "boolean" },
          when: { type: "datetime" },
        },
        groups: [{ title: en("More", "Więcej"), fields: ["name"] }],
        computed: {
          total: { label: en("Total", "Razem"), value: (r) => Number(r.qty ?? 0) },
          bare: (r) => String(r.name ?? ""),
        },
        actions: {
          buy: { label: en("Buy", "Kup"), input: { note: { type: "text", label: en("Note", "Notatka") } }, run: () => {} },
        },
      },
    },
    pages: [
      {
        id: "list",
        title: en("List", "Lista"),
        summary: [{ label: en("Items", "Produkty"), op: "count" }],
        actions: [{ label: en("Clear", "Wyczyść"), run: () => {} }],
        view: {
          type: "list",
          entity: "item",
          emptyText: en("Nothing", "Nic"),
          filters: [{ label: en("Search", "Szukaj"), param: "q", type: "text", placeholder: en("Name", "Nazwa") }],
        },
      },
      {
        id: "detail",
        title: "Detail",
        view: { type: "detail", entity: "item", sections: [{ title: en("Main", "Główne"), fields: ["name"] }], actions: [{ label: en("Back", "Wróć"), navigate: { page: "list" } }] },
      },
      { id: "stats", title: "Stats", view: { type: "stats", entity: "item", items: [{ label: en("Total", "Razem"), op: "sum", field: "qty", unit: en("pcs", "szt"), compare: { value: () => 1, label: en("last week", "zeszły tydzień") } }] } },
      { id: "chart", title: "Chart", view: { type: "chart", entity: "item", series: () => [], title: en("Chart", "Wykres"), subtitle: en("Sub", "Pod"), emptyText: en("None", "Brak") } },
      { id: "agg", title: "Agg", view: { type: "aggregate", entity: "item", rows: () => [], title: en("Owed", "Długi"), emptyText: en("Nobody", "Nikt") } },
      {
        id: "home",
        title: "Home",
        layout: {
          type: "stack",
          items: [
            { title: en("Open", "Otwarte"), view: { type: "checklist", entity: "item", done: "got", emptyText: en("Done", "Gotowe") } as never },
            { title: en("Later", "Później"), view: { type: "timeline", entity: "item", date: "when", emptyText: en("Empty", "Pusto") } as never },
            { title: en("Pics", "Zdjęcia"), view: { type: "gallery", entity: "item", emptyText: en("No pics", "Brak") } },
          ],
        },
      },
    ],
  };
}

describe("Words slots (docs/20 §1.2)", () => {
  test("a plain-string app is valid, and localize returns the very same definition", () => {
    const app = defineApp({ id: "plain", name: "Plain", version: "1.0.0", schemaVersion: 1, entities: { a: { label: "A", fields: { x: { type: "text", label: "X" } } } }, pages: [{ id: "p", title: "P", view: { type: "list", entity: "a" } }] });
    expect(localize(app, "pl")).toBe(app);
    expect(wordSlots(app).every((s) => typeof s.value === "string")).toBe(true);
  });

  test("every slot of the table accepts a map, and localize leaves only strings behind", () => {
    const app = defineApp({ ...everySlot(), pages: everySlot().pages.filter((p) => p.id !== "home") });
    const slots = wordSlots(app).map((s) => wordsPathText(s.path));
    for (const path of [
      "name",
      "scope.label",
      "quickActions.0.label",
      "entities.item.label",
      "entities.item.fields.name.label",
      "entities.item.fields.name.help",
      "entities.item.fields.name.placeholder",
      "entities.item.fields.qty.unit",
      "entities.item.fields.kind.labels.produce",
      "entities.item.fields.tags.labels.cold",
      "entities.item.fields.parts.of.part.label",
      "entities.item.groups.0.title",
      "entities.item.computed.total.label",
      "entities.item.actions.buy.label",
      "entities.item.actions.buy.input.note.label",
      "pages.0.title",
      "pages.0.summary.0.label",
      "pages.0.actions.0.label",
      "pages.0.view.emptyText",
      "pages.0.view.filters.0.label",
      "pages.0.view.filters.0.placeholder",
      "pages.1.view.sections.0.title",
      "pages.1.view.actions.0.label",
      "pages.2.view.items.0.label",
      "pages.2.view.items.0.unit",
      "pages.2.view.items.0.compare.label",
      "pages.3.view.title",
      "pages.3.view.subtitle",
      "pages.3.view.emptyText",
      "pages.4.view.title",
      "pages.4.view.emptyText",
    ]) expect(slots).toContain(path);

    const pl = localize(app, "pl");
    expect(wordSlots(pl).every((s) => typeof s.value === "string")).toBe(true);
    expect(pl.name).toBe("Zakupy");
    expect(pl.entities.item!.fields.kind).toMatchObject({ labels: { produce: "Warzywa", dairy: "Nabiał" } });
    expect(pl.pages[0]!.view).toMatchObject({ emptyText: "Nic", filters: [{ label: "Szukaj", placeholder: "Nazwa" }] });
    expect(localize(app, "en").pages[2]!.view).toMatchObject({ items: [{ label: "Total", unit: "pcs", compare: { label: "last week" } }] });
  });

  test("layout item titles and the views inside them are slots too", () => {
    const app = defineApp(everySlot());
    const pl = localize(app, "pl");
    const home = pl.pages.find((p) => p.id === "home")!;
    expect(home.layout!.items.map((i) => i.title)).toEqual(["Otwarte", "Później", "Zdjęcia"]);
    expect(home.layout!.items[1]!.view).toMatchObject({ emptyText: "Pusto" });
    expect(home.view).toMatchObject({ emptyText: "Gotowe" }); // the page's view is its first item's
  });

  test("localize keeps functions, the brand, and everything that is not words", () => {
    const app = defineApp(everySlot());
    const pl = localize(app, "pl");
    expect(pl.__potyroApp).toBe(true);
    expect(typeof (pl.entities.item!.actions!.buy as { run: unknown }).run).toBe("function");
    expect(pl.entities.item!.computed!.total).toMatchObject({ label: "Razem" });
    expect(typeof (pl.entities.item!.computed!.total as { value: unknown }).value).toBe("function");
    expect(typeof pl.entities.item!.computed!.bare).toBe("function");
    expect(pl.entities.item!.fields.kind).toMatchObject({ options: ["produce", "dairy"] }); // values are data
    expect(pl.language).toBe("en");
    expect(pl.entities.trip!.fields).toBe(app.entities.trip!.fields); // untouched parts keep their identity
  });

  test("a definition read out of the sealed box (sentinels for functions) localizes the same", () => {
    const json = JSON.parse(JSON.stringify(defineApp(everySlot()), (_k, v) => (typeof v === "function" ? "__potyro_fn__" : v)));
    const pl = localize(json, "pl");
    expect(pl.pages[0].actions[0]).toEqual({ label: "Wyczyść", run: "__potyro_fn__" });
    expect(pl.entities.item.actions.buy.label).toBe("Kup");
    expect(pl.entities.item.computed.total).toEqual({ label: "Razem", value: "__potyro_fn__" });
    expect(pl.pages[3].view.series).toBe("__potyro_fn__");
  });

  test("a Dynamic<Words> function stays a function", () => {
    const app = defineApp({ ...everySlot(), pages: [{ id: "p", title: (ctx) => ctx.t({ en: "A", pl: "B" }), view: { type: "list", entity: "item" } }] });
    expect(typeof localize(app, "pl").pages[0]!.title).toBe("function");
  });
});

describe("checkWords (docs/20 §1.4)", () => {
  const base = (extra: Partial<AppInput>): AppInput => ({ id: "w", name: "W", version: "1.0.0", schemaVersion: 1, entities: { a: { fields: { x: { type: "text" } } } }, pages: [{ id: "p", title: "P", view: { type: "list", entity: "a" } }], ...extra });

  test("a map needs `language`, and the message names the slot", () => {
    expect(() => defineApp(base({ pages: [{ id: "p", title: { en: "P" }, view: { type: "list", entity: "a" } }] }))).toThrow(/pages\.0\.title is a translation map, so the app needs `language:`/);
  });

  test("every map has the app's own language", () => {
    expect(() => defineApp(base({ language: "en", languages: ["en", "pl"], name: { pl: "W" } }))).toThrow(/name has no "en"/);
  });

  test("a key that is not one of the app's languages is a typo, and an error", () => {
    expect(() => defineApp(base({ language: "en", languages: ["en", "pl"], name: { en: "W", de: "W" } }))).toThrow(/name has "de", which is not one of the app's languages \(en, pl\)/);
  });

  test("a malformed tag is rejected by the shape check", () => {
    expect(() => defineApp(base({ language: "en", name: { en: "W", pt_BR: "W" } }))).toThrow(/pt_BR" is not a language tag/);
    expect(() => defineApp(base({ language: "english" }))).toThrow(/language tag/);
  });

  test("languages includes language", () => {
    expect(() => defineApp(base({ language: "en", languages: ["pl"] }))).toThrow(/languages must include the app's own language "en"/);
    expect(() => defineApp(base({ languages: ["pl"] }))).toThrow(/needs `language:`/);
  });

  test("a missing OTHER language is not an error (it falls back per string)", () => {
    const app = defineApp(base({ language: "en", languages: ["en", "pl", "de"], name: { en: "Shop", pl: "Sklep" } }));
    expect(checkWords(app)).toEqual([]);
    expect(wordGaps(app)).toEqual([{ path: "name", missing: ["de"] }]);
    expect(localize(app, "de").name).toBe("Shop");
  });

  test("labels keys must be options", () => {
    const fields = { s: { type: "enum" as const, options: ["todo", "done"], labels: { todo: "To do", finished: "Done" } } };
    expect(() => defineApp(base({ entities: { a: { fields } } }))).toThrow(/entities\.a\.fields\.s\.labels names "finished", which is not an option \(todo, done\)/);
  });

  test("a value that is neither text nor a map says what words are", () => {
    expect(() => defineApp(base({ entities: { a: { label: 5 as never, fields: { x: { type: "text" } } } } }))).toThrow(/entities\.a\.label: expected text, or a map of languages to text/);
  });

  test("the slots that refused an empty label still do", () => {
    expect(() => defineApp(base({ pages: [{ id: "p", title: "P", actions: [{ label: "", run: () => {} }], view: { type: "list", entity: "a" } }] }))).toThrow(/pages\.0\.actions\.0\.label: must not be empty/);
  });
});

describe("resolution (docs/20 §3.1)", () => {
  const app = { language: "en", languages: ["en", "pl", "pt-BR"] };

  test("exact tag, then same base language, per preference in order", () => {
    expect(pickLanguage(["pt-BR"], app)).toBe("pt-BR");
    expect(pickLanguage(["pl-PL", "en"], app)).toBe("pl");
    expect(pickLanguage(["pt-PT"], app)).toBe("pt-BR");
    expect(pickLanguage(["fr-FR", "pl"], app)).toBe("pl"); // a French phone with Polish second
  });

  test("no match → the app's own language; no language at all → undefined", () => {
    expect(pickLanguage(["de-DE"], app)).toBe("en");
    expect(pickLanguage([], app)).toBe("en");
    expect(pickLanguage(["pl"], {})).toBeUndefined();
    expect(pickLanguage(["pl"], { language: "pl" })).toBe("pl");
  });

  test("word falls back: the language, the app's own, its languages, anything", () => {
    expect(word("Plain", "pl", app)).toBe("Plain");
    expect(word({ en: "Item", pl: "Produkt" }, "pl", app)).toBe("Produkt");
    expect(word({ en: "Item", pl: "Produkt" }, "de", app)).toBe("Item");
    expect(word({ pl: "Produkt", "pt-BR": "Produto" }, "de", app)).toBe("Produkt");
    expect(word({ fr: "Article" }, "pl", app)).toBe("Article");
    expect(word(undefined, "pl", app)).toBe("");
  });
});

describe("a computed value's label (#310)", () => {
  const app = (computed: Record<string, unknown>): AppInput => ({
    id: "c", name: "C", version: "1.0.0", schemaVersion: 1, language: "en", languages: ["en", "pl"],
    entities: { a: { fields: { x: { type: "number" } }, computed: computed as never } },
    pages: [{ id: "p", title: "P", view: { type: "list", entity: "a" } }],
  });

  test("a map without the app's own language is an error that names the slot", () => {
    expect(() => defineApp(app({ k: { label: { pl: "Razem" }, value: () => 1 } }))).toThrow(/entities\.a\.computed\.k\.label has no "en"/);
  });

  test("a missing other language is a gap the completeness report sees", () => {
    expect(wordGaps(defineApp(app({ k: { label: { en: "Total" }, value: () => 1 } })))).toEqual([{ path: "entities.a.computed.k.label", missing: ["pl"] }]);
  });

  test("the object form needs a value function, and takes nothing else", () => {
    expect(() => defineApp(app({ k: { label: "Total" } }))).toThrow(/computed/);
    expect(() => defineApp(app({ k: { label: "Total", value: () => 1, colour: "red" } }))).toThrow(/colour/);
  });
});
