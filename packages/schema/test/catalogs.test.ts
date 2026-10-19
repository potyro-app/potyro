// App catalogs (docs/30): an app written in one language, its translations attached beside it.

import { describe, expect, test } from "vitest";
import { defineApp } from "../src/defineApp.js";
import { appLanguages, attachCatalogs, catalogFor, localize, lookup, pickLanguage, word, wordSlots } from "../src/words.js";

function app(legacy = false) {
  return defineApp({
    id: "plants",
    name: "Plants",
    version: "1.0.0",
    schemaVersion: 1,
    language: "en",
    ...(legacy ? { languages: ["en", "pl"] } : {}),
    entities: {
      plant: {
        label: "Plant",
        fields: {
          name: { type: "text", label: "Name", placeholder: "Fern" },
          kind: { type: "enum", options: ["fern", "cactus"], labels: { fern: "Fern", cactus: "Cactus" } },
        },
      },
    },
    pages: [{ id: "today", title: "Today", icon: "☀️", actions: [{ label: { text: "Water", context: "verb" }, run: () => {} }], view: { type: "list", entity: "plant", emptyText: legacy ? { en: "Nothing yet", pl: "Jeszcze nic" } : "Nothing yet" } }],
  } as never);
}

const PL = { Plants: "Rośliny", Today: "Dziś", Name: "Nazwa", Fern: "Paproć", Cactus: "", "verb\u0004Water": "Podlej" };

describe("catalogs", () => {
  test("a definition is shown through its catalog; what the catalog lacks, or leaves empty, stays as written", () => {
    const def = app();
    attachCatalogs(def, { pl: PL });
    const shown = localize(def, "pl") as unknown as Record<string, any>;
    expect(shown.name).toBe("Rośliny");
    expect(shown.pages[0].title).toBe("Dziś");
    expect(shown.entities.plant.fields.name.label).toBe("Nazwa");
    expect(shown.entities.plant.fields.name.placeholder).toBe("Paproć");
    expect(shown.entities.plant.label).toBe("Plant"); // not in the catalog
    expect(shown.entities.plant.fields.kind.labels.cactus).toBe("Cactus"); // empty msgstr
    // English is the source: no catalog, nothing changes.
    expect((localize(def, "en") as unknown as Record<string, any>).pages[0].title).toBe("Today");
  });

  test("a legacy inline map is still read, beside the catalog", () => {
    const def = app(true);
    attachCatalogs(def, { pl: PL });
    expect((localize(def, "pl") as unknown as Record<string, any>).pages[0].view.emptyText).toBe("Jeszcze nic");
  });

  test("the languages an app carries include the ones it has a catalog for, so the person's is picked", () => {
    const def = app();
    expect(pickLanguage(["pl-PL"], def)).toBe("en");
    attachCatalogs(def, { pl: PL, de: {} });
    expect(appLanguages(def)).toEqual(["en", "pl", "de"]);
    expect(pickLanguage(["pl-PL"], def)).toBe("pl");
  });

  test("attaching new catalogs forgets what was shown before (a translation edited in Files)", () => {
    const def = app();
    attachCatalogs(def, { pl: PL });
    expect((localize(def, "pl") as unknown as Record<string, any>).pages[0].title).toBe("Dziś");
    attachCatalogs(def, { pl: { ...PL, Today: "Dzisiaj" } });
    expect((localize(def, "pl") as unknown as Record<string, any>).pages[0].title).toBe("Dzisiaj");
    attachCatalogs(def, undefined);
    expect((localize(def, "pl") as unknown as Record<string, any>).pages[0].title).toBe("Today");
  });

  test("a slot with a context is looked up apart from the same text without one", () => {
    const def = app();
    attachCatalogs(def, { pl: { ...PL, Water: "Woda" } });
    const shown = localize(def, "pl") as unknown as Record<string, any>;
    expect(shown.pages[0].actions[0].label).toBe("Podlej");
    expect(word("Water", "pl", def)).toBe("Woda");
    // Without a catalog it is its text, a plain string for the views.
    expect((localize(def, "en") as unknown as Record<string, any>).pages[0].actions[0].label).toBe("Water");
  });

  test("word() and lookup(): a string through the app's catalog, a context kept apart", () => {
    const def = app();
    attachCatalogs(def, { pl: PL });
    expect(word("Today", "pl", def)).toBe("Dziś");
    expect(word("Today", "pl", { language: "en" }, catalogFor(def, "pl"))).toBe("Dziś");
    expect(lookup("Water", catalogFor(def, "pl"))).toBe("Water");
    expect(lookup("Water", catalogFor(def, "pl"), "verb")).toBe("Podlej");
  });

  test("an action whose run names a function still has its label found (read from source: run is code)", () => {
    const def = { id: "x", entities: { w: { fields: {}, actions: { a: { label: "A", run: "__potyro_fn__" }, b: { label: "Stop watching", run: "__potyro_code__" } } } }, pages: [] };
    expect(wordSlots(def).map((s) => s.value)).toEqual(["A", "Stop watching"]);
  });
});
