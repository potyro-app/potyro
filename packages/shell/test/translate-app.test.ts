// "Translate into…" and "Update translations" (docs/30 §5): the catalog lands in the app's folder,
// where the app reads it when it opens, and only what is missing is asked for.

import { describe, expect, it } from "vitest";
import { MemoryStore, fileSpace } from "@potyro/store";
import type { AiCall, AiCap } from "@potyro/capabilities";
import { compileCatalog } from "@potyro/i18n/app-catalogs";
import { readCatalogs } from "../src/app-catalogs.js";
import { translateApp, translationGaps } from "../src/translate-app.js";

const SOURCE = `import { defineApp } from "potyro";
import { EMPTY } from "./words.js";
export default defineApp({
  id: "plants", name: "Plants", version: "1.0.0", schemaVersion: 1, language: "en",
  entities: { plant: { label: "Plant", fields: { name: { type: "text", label: "Name" } } } },
  pages: [{ id: "today", title: "Today", view: { type: "list", entity: "plant", emptyText: (ctx) => ctx.t(EMPTY) } }],
});
`;
const WORDS = `import { msg } from "potyro";\nexport const EMPTY = msg("Nothing to water");\n`;

const POLISH: Record<string, string> = { Plants: "Rośliny", Plant: "Roślina", Name: "Nazwa", Today: "Dziś", "Nothing to water": "Nic do podlania", "Today's plants": "Dzisiejsze rośliny" };

/** The AI allowance, answering from a dictionary; it records each call. */
function fakeAi(calls: AiCall[]): AiCap {
  return {
    complete: async (call) => {
      calls.push(call);
      const list = JSON.parse((call.parts[0] as { text: string }).text) as Array<{ n: string; text: string }>;
      return { text: JSON.stringify(Object.fromEntries(list.map((m) => [m.n, POLISH[m.text] ?? ""]))), via: "free" };
    },
  } as AiCap;
}

async function appStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await fileSpace(store).write(".src/words.ts", new Blob([WORDS]), { origin: "shipped" });
  return store;
}

describe("translateApp", () => {
  it("writes the language's catalog into the app's folder, with its modules' words, and the app reads it", async () => {
    const store = await appStore();
    const calls: AiCall[] = [];
    const out = await translateApp({ store, source: SOURCE, language: "pl", ai: fakeAi(calls) });
    expect(out).toEqual({ asked: 5, translated: 5, left: 0 });
    expect(calls).toHaveLength(1);
    // A strict schema: every number the model was given, and only those.
    expect(calls[0]!.json).toMatchObject({ required: ["1", "2", "3", "4", "5"], additionalProperties: false });
    const file = await fileSpace(store).find("locales/pl.po");
    expect(file?.origin).toBe("shipped");
    expect((await readCatalogs(store)).pl).toMatchObject({ Today: "Dziś", "Nothing to water": "Nic do podlania" });
  });

  it("counts what changed since, and asks only for that", async () => {
    const store = await appStore();
    await translateApp({ store, source: SOURCE, language: "pl", ai: fakeAi([]) });
    const changed = SOURCE.replace('title: "Today"', 'title: "Today\'s plants"');
    expect(await translationGaps(store, SOURCE, "pl")).toBe(0);
    expect(await translationGaps(store, changed, "pl")).toBe(1);
    const calls: AiCall[] = [];
    await translateApp({ store, source: changed, language: "pl", ai: fakeAi(calls) });
    expect(JSON.parse((calls[0]!.parts[0] as { text: string }).text).map((m: { text: string }) => m.text)).toEqual(["Today's plants"]);
    const po = await (await fileSpace(store).read("locales/pl.po"))!.text();
    expect(compileCatalog(po)).toMatchObject({ Plant: "Roślina", "Today's plants": "Dzisiejsze rośliny" });
  });

  it("counts nothing for a language the app was never translated into", async () => {
    expect(await translationGaps(await appStore(), SOURCE, "de")).toBe(0);
  });
});

describe("fixing a word in Files", () => {
  const PO = `msgid ""\nmsgstr "Language: pl\\n"\n\nmsgid "Today"\nmsgstr "Dziś"\n`;
  async function withCatalog() {
    const store = new MemoryStore();
    const f = await fileSpace(store).write("locales/pl.po", new Blob([PO]), { mime: "text/x-gettext-translation", origin: "shipped" });
    return { store, id: f.id };
  }

  it("saves a catalog's new text, keeps the old one as an earlier copy, and the app reads the new word", async () => {
    const { saveCatalogText } = await import("../src/app-folder.js");
    const { store, id } = await withCatalog();
    await saveCatalogText(store, id, PO.replace('msgstr "Dziś"', 'msgstr "Dzisiaj"'));
    expect((await readCatalogs(store)).pl).toMatchObject({ Today: "Dzisiaj" });
    expect(await fileSpace(store).earlier("locales/pl.po")).toHaveLength(1);
    expect((await fileSpace(store).find("locales/pl.po"))?.origin).toBe("shipped");
  });

  it("refuses text that does not read as a catalog, and any file that is not one", async () => {
    const { saveCatalogText } = await import("../src/app-folder.js");
    const { store, id } = await withCatalog();
    await expect(saveCatalogText(store, id, 'msgid "Today"\nmsgstr "Dzi')).rejects.toThrow();
    expect((await readCatalogs(store)).pl).toMatchObject({ Today: "Dziś" });
    const other = await fileSpace(store).write("notes/a.txt", new Blob(["hi"]), { mime: "text/plain" });
    await expect(saveCatalogText(store, other.id, "changed")).rejects.toThrow();
  });
});
