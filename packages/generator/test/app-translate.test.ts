// The translate step: only what needs it goes to the model, and a broken answer never reaches the app (docs/30 §5).

import { describe, expect, it } from "vitest";
import { compileCatalog, readPo } from "@potyro/i18n/app-catalogs";
import { catalogGaps, translateCatalog, type AskModel } from "../src/app-translate.js";

const SOURCE = `import { defineApp } from "potyro";
export default defineApp({
  id: "plants", name: "Plants", version: "1.0.0", schemaVersion: 1, language: "en",
  entities: { plant: { label: "Plant", fields: { name: { type: "text", label: "Name" } },
    actions: { water: { label: "Water", run: async (p, ctx) => ctx.ui.toast(ctx.t("Watered {name}", { name: p.name })) } } } },
  pages: [{ id: "today", title: "Today", view: { type: "list", entity: "plant", display: { primary: "name" } } }],
});
`;

const POLISH: Record<string, string> = { Plants: "Rośliny", Plant: "Roślina", Name: "Nazwa", Water: "Podlej", Today: "Dziś", "Watered {name}": "Podlano {name}" };

/** A model that answers from a dictionary, and records what it was asked. */
function fakeModel(words: Record<string, string>, asked: string[][]): AskModel {
  return async ({ user }) => {
    const list = JSON.parse(user) as Array<{ n: string; text: string }>;
    asked.push(list.map((m) => m.text));
    return "```json\n" + JSON.stringify(Object.fromEntries(list.map((m) => [m.n, words[m.text] ?? ""]))) + "\n```";
  };
}

describe("translateCatalog", () => {
  it("makes a new language's catalog from the app's words, in one call", async () => {
    const asked: string[][] = [];
    const out = await translateCatalog({ source: SOURCE, language: "pl", ask: fakeModel(POLISH, asked) });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual(["Plants", "Plant", "Name", "Water", "Today", "Watered {name}"]);
    expect(out).toMatchObject({ asked: 6, translated: 6, left: [] });
    expect(compileCatalog(out.po)).toMatchObject({ Today: "Dziś", "Watered {name}": "Podlano {name}" });
    expect(readPo(out.po).language).toBe("pl");
  });

  it("asks only for what is new or changed, and keeps what was translated", async () => {
    const first = await translateCatalog({ source: SOURCE, language: "pl", ask: fakeModel(POLISH, []) });
    const changed = SOURCE.replace('title: "Today"', 'title: "Today\'s plants"').replace('ctx.t("Watered {name}"', 'ctx.t("Watered {name}!"');
    expect(await catalogGaps(changed, [], "pl", first.po)).toBe(2);
    const asked: string[][] = [];
    const out = await translateCatalog({ source: changed, language: "pl", po: first.po, ask: fakeModel({ "Today's plants": "Dzisiejsze rośliny", "Watered {name}!": "Podlano {name}!" }, asked) });
    expect(asked).toEqual([["Today's plants", "Watered {name}!"]]);
    expect(compileCatalog(out.po)).toMatchObject({ Plant: "Roślina", "Today's plants": "Dzisiejsze rośliny", "Watered {name}!": "Podlano {name}!" });
  });

  it("leaves out a translation that breaks a placeholder or is missing, so the source text shows there", async () => {
    const out = await translateCatalog({ source: SOURCE, language: "pl", ask: fakeModel({ ...POLISH, "Watered {name}": "Podlano {imie}", Name: "" }, []) });
    expect(out.left).toEqual(["Name", "Watered {name}"]);
    const catalog = compileCatalog(out.po);
    expect(catalog["Watered {name}"]).toBeUndefined();
    expect(catalog.Name).toBeUndefined();
    expect(catalog.Plants).toBe("Rośliny");
  });

  it("sends batches no larger than asked, each with its answer's keys", async () => {
    const keys: string[][] = [];
    const ask: AskModel = async (r) => {
      keys.push([...r.keys]);
      const list = JSON.parse(r.user) as Array<{ n: string; text: string }>;
      return JSON.stringify(Object.fromEntries(list.map((m) => [m.n, POLISH[m.text]])));
    };
    const out = await translateCatalog({ source: SOURCE, language: "pl", ask, batch: 4 });
    expect(keys).toEqual([["1", "2", "3", "4"], ["1", "2"]]);
    expect(out.translated).toBe(6);
  });

  it("asks nothing when the catalog is complete", async () => {
    const first = await translateCatalog({ source: SOURCE, language: "pl", ask: fakeModel(POLISH, []) });
    const asked: string[][] = [];
    const out = await translateCatalog({ source: SOURCE, language: "pl", po: first.po, ask: fakeModel(POLISH, asked) });
    expect(asked).toEqual([]);
    expect(out.asked).toBe(0);
  });
});
