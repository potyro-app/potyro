import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accusable, appParts, liftedRules, mentionedParts, near, partsNote, siblingFaults, siblingsNote, unansweredParts, wordsOf } from "../src/request-parts.js";
import { readSourceWords, type SourceWords } from "../src/source-words.js";
import { MODIFY_CASES } from "../src/modify-corpus.js";
import { EVAL_LANGUAGES, localizeModifyCase } from "../src/translated-cases.js";

// Was every part of the request answered? (#73) Structure only, no model: an app's source before and
// after an edit, the request, and what the reply listed as not done. The tables below are the measure
// of the one risk this check has — asking the model about something that was not left out — over
// requests in the six languages the product is used in.

/** A wine cellar, its words in `words`: the same app in every language the tables use. */
interface Words {
  bottle: string;
  name: string;
  grape: string;
  country: string;
  region: string;
  vintage: string;
  notes: string;
  price: string;
  winery: string;
  drink: string;
  archive: string;
  scan: string;
}
const EN: Words = { bottle: "Bottle", name: "Name", grape: "Grape", country: "Country", region: "Region", vintage: "Vintage", notes: "Tasting notes", price: "Price", winery: "Winery", drink: "Drink", archive: "Archive", scan: "Scan label" };
const PT: Words = { bottle: "Garrafa", name: "Nome", grape: "Uva", country: "País", region: "Região", vintage: "Safra", notes: "Notas de degustação", price: "Preço", winery: "Vinícola", drink: "Beber", archive: "Arquivar", scan: "Ler rótulo" };
const DE: Words = { bottle: "Flasche", name: "Name", grape: "Rebsorte", country: "Land", region: "Region", vintage: "Jahrgang", notes: "Verkostungsnotizen", price: "Preis", winery: "Weingut", drink: "Trinken", archive: "Archivieren", scan: "Etikett scannen" };
const ES: Words = { bottle: "Botella", name: "Nombre", grape: "Uva", country: "País", region: "Región", vintage: "Añada", notes: "Notas de cata", price: "Precio", winery: "Bodega", drink: "Beber", archive: "Archivar", scan: "Leer etiqueta" };
const IT: Words = { bottle: "Bottiglia", name: "Nome", grape: "Vitigno", country: "Paese", region: "Regione", vintage: "Annata", notes: "Note di degustazione", price: "Prezzo", winery: "Cantina", drink: "Bevi", archive: "Archivia", scan: "Leggi etichetta" };
const PL: Words = { bottle: "Butelka", name: "Nazwa", grape: "Szczep", country: "Kraj", region: "Region", vintage: "Rocznik", notes: "Notatki z degustacji", price: "Cena", winery: "Winnica", drink: "Wypij", archive: "Archiwizuj", scan: "Odczytaj etykietę" };

const cellar = (w: Words): string =>
  `import { defineApp } from "potyro";

export default defineApp({
  id: "cellar",
  name: "Cellar",
  entities: {
    bottle: {
      label: "${w.bottle}",
      fields: {
        name: { type: "text", label: "${w.name}", required: true },
        grape: { type: "enum", label: "${w.grape}", options: ["merlot", "syrah"] },
        country: { type: "enum", label: "${w.country}", options: ["france", "italy"] },
        region: { type: "enum", label: "${w.region}", options: ["north", "south"] },
        vintage: { type: "number", label: "${w.vintage}", min: 1900, integer: true },
        notes: { type: "text", label: "${w.notes}", multiline: true },
        price: { type: "money", label: "${w.price}", required: true },
        winery: { type: "relation", to: "winery", label: "${w.winery}" },
        order: { type: "number", hidden: true },
      },
      actions: {
        drink: { label: "${w.drink}", run: async (r, ctx) => { await ctx.data.update("bottle", r.id, { drunk: true }); } },
        archive: { label: "${w.archive}", run: async (r, ctx) => { await ctx.data.remove("bottle", r.id); } },
      },
      fill: [{ label: "${w.scan}", icon: "camera", run: async (draft, ctx) => ({ name: "x" }) }],
    },
    winery: {
      label: "${w.winery}",
      fields: { name: { type: "text", label: "${w.name}" } },
    },
  },
  pages: [
    { id: "cellar", title: "Cellar", view: { type: "list", entity: "bottle", sort: (a, b) => a.name.localeCompare(b.name) } },
    { id: "wineries", title: "Wineries", view: { type: "list", entity: "winery" } },
  ],
});
`;

const read = async (source: string): Promise<SourceWords> => {
  const sw = await readSourceWords(source);
  if (!sw) throw new Error("the fixture does not read as an app");
  return sw;
};

/** Replace one piece of the app, as an edit would; throws when the piece is not there (a stale fixture). */
function change(source: string, ...pairs: Array<[string, string]>): string {
  let out = source;
  for (const [from, to] of pairs) {
    if (!out.includes(from)) throw new Error(`the fixture has no "${from}"`);
    out = out.replace(from, to);
  }
  return out;
}

const fieldLine = (w: Words, key: "grape" | "country" | "region"): string => {
  const options = { grape: '["merlot", "syrah"]', country: '["france", "italy"]', region: '["north", "south"]' }[key];
  return `${key}: { type: "enum", label: "${w[key]}", options: ${options} }`;
};
const asText = (w: Words, key: "grape" | "country" | "region"): [string, string] => [fieldLine(w, key), `${key}: { type: "text", label: "${w[key]}" }`];

async function unanswered(w: Words, request: string, after: string, said: string[] = []): Promise<string[]> {
  const before = cellar(w);
  return unansweredParts(request, { before: await read(before), after: await read(after), said }).map((m) => m.name);
}
async function siblings(w: Words, request: string, after: string, said: string[] = []): Promise<string[]> {
  return siblingFaults(request, { before: await read(cellar(w)), after: await read(after), said }).flatMap((f) => f.siblings.map((s) => s.ref));
}

describe("the app's parts, read from its source", () => {
  it("lists every field, action and form button with the words the app shows; hidden fields are not parts", async () => {
    const parts = appParts(await read(cellar(EN)));
    expect(parts.map((p) => p.ref)).toEqual([
      "bottle.name",
      "bottle.grape",
      "bottle.country",
      "bottle.region",
      "bottle.vintage",
      "bottle.notes",
      "bottle.price",
      "bottle.winery",
      "bottle.actions.drink",
      "bottle.actions.archive",
      "bottle.fill:Scan label",
      "winery.name",
    ]);
    expect(parts.find((p) => p.ref === "bottle.notes")!.names).toEqual(["Tasting notes"]);
  });

  it("reads a label in every language a map carries, a missing label as the key made readable, and a label behind a const as nothing", async () => {
    const src = `export default defineApp({ entities: { task: { fields: {
      dueDate: { type: "datetime" },
      title: { type: "text", label: { en: "Title", pl: "Tytuł" } },
      kind: { type: "text", label: { text: "Kind", context: "of task" } },
      late: { type: "boolean", label: LABELS.late },
    }, actions: { markDone: (r, ctx) => {} } } }, pages: [{ id: "all", title: "All", actions: [{ label: "Clear done", run: () => {} }], view: { type: "list", entity: "task" } }] });`;
    const parts = appParts(await read(src));
    expect(Object.fromEntries(parts.map((p) => [p.ref, p.names]))).toEqual({
      "task.dueDate": ["Due Date"],
      "task.title": ["Title", "Tytuł"],
      "task.kind": ["Kind"],
      "task.late": [],
      "task.actions.markDone": ["Mark Done"],
      "page:all.actions:Clear done": ["Clear done"],
    });
  });

  it("a field that goes by the name of a kind of record is never accused", async () => {
    const refs = accusable(await read(cellar(EN))).map((p) => p.ref);
    expect(refs).not.toContain("bottle.winery");
    expect(refs).toContain("bottle.country");
  });
});

describe("words", () => {
  it("folds case and accents, and splits identifiers where their case changes", () => {
    expect(wordsOf("O País e a Região")).toEqual(["o", "pais", "e", "a", "regiao"]);
    expect(wordsOf("isToday(r.tastingNotes)")).toEqual(["is", "today", "r", "tasting", "notes"]);
    expect(wordsOf("Jahrgang: größer")).toEqual(["jahrgang", "großer"]);
  });

  it("near forms excuse; unrelated words do not", () => {
    for (const [a, b] of [["country", "countries"], ["kraj", "kraju"], ["uva", "uvas"], ["land", "lander"], ["pais", "paises"], ["note", "notes"], ["rebsorte", "rebsorten"]] as const) expect(near(a, b), `${a}/${b}`).toBe(true);
    for (const [a, b] of [["date", "data"], ["name", "note"], ["cena", "cel"], ["price", "prize"], ["land", "landscape"], ["no", "not"]] as const) expect(near(a, b), `${a}/${b}`).toBe(false);
  });
});

describe("the parts a request names", () => {
  const names = async (w: Words, request: string): Promise<string[]> => mentionedParts(request, accusable(await read(cellar(w)))).map((m) => m.name);

  it("finds the app's own words, whatever their case or accents", async () => {
    expect(await names(EN, "make grape and COUNTRY free text")).toEqual(["Grape", "Country"]);
    expect(await names(PT, "deixa a uva e o pais como texto livre")).toEqual(["Uva", "País"]);
    expect(await names(PL, "Szczep i kraj mają być zwykłym tekstem")).toEqual(["Szczep", "Kraj"]);
  });

  it("a name inside a longer name that matched is not a mention of its own", async () => {
    const src = `export default defineApp({ entities: { wine: { fields: { notes: { type: "text", label: "Notes" }, tasting: { type: "text", label: "Tasting notes" } } } }, pages: [] });`;
    expect(mentionedParts("make the tasting notes longer", appParts(await read(src))).map((m) => m.name)).toEqual(["Tasting notes"]);
  });

  it("one name that several parts go by is one mention", async () => {
    const [m] = mentionedParts("the name should be optional", appParts(await read(cellar(EN))));
    expect(m!.parts.map((p) => p.ref)).toEqual(["bottle.name", "winery.name"]);
  });

  it("an inflected form is NOT a match: such a request is not checked (the known limit)", async () => {
    expect(await names(EN, "let me type any of the countries and grapes")).toEqual([]);
    expect(await names(PL, "pozwól wpisać dowolny tekst w kraju i szczepie")).toEqual([]);
    expect(await names(DE, "bei den Ländern und Rebsorten soll freier Text gehen")).toEqual([]);
    expect(await names(PT, "quero digitar os países e as uvas livremente")).toEqual([]);
    expect(await names(IT, "voglio scrivere liberamente paesi e vitigni")).toEqual([]);
    expect(await names(ES, "quiero escribir libremente los países y las uvas")).toEqual([]);
  });

  it("too short to mean anything is never a name", async () => {
    const src = `export default defineApp({ entities: { x: { fields: { id: { type: "text", label: "ID" }, n: { type: "number", label: "Nº" } } } }, pages: [] });`;
    expect(mentionedParts("show the id and the nº on the card", appParts(await read(src)))).toEqual([]);
  });
});

describe("parts of the request left unanswered", () => {
  // The same request in six languages, answered in part: the first named field made free text, the
  // second left a list with not a word about it.
  const PARTLY: Array<[string, Words, string]> = [
    ["en", EN, "Make Grape and Country free text, so the scan does not fail"],
    ["pt-BR", PT, "Deixa Uva e País como texto livre, pra leitura do rótulo não falhar"],
    ["de", DE, "Mach Rebsorte und Land zu Freitext, damit der Scan nicht scheitert"],
    ["es", ES, "Haz que Uva y País sean texto libre, para que no falle al leer la etiqueta"],
    ["it", IT, "Rendi Vitigno e Paese testo libero, così la lettura non fallisce"],
    ["pl", PL, "Niech Szczep i Kraj będą zwykłym tekstem, żeby skan się nie wywalał"],
  ];

  it.each(PARTLY)("%s: one named field changed, the other not answered → the other is named", async (_l, w, request) => {
    expect(await unanswered(w, request, change(cellar(w), asText(w, "grape")))).toEqual([w.country]);
  });

  it.each(PARTLY)("%s: both changed → nothing", async (_l, w, request) => {
    expect(await unanswered(w, request, change(cellar(w), asText(w, "grape"), asText(w, "country")))).toEqual([]);
  });

  it.each(PARTLY)("%s: the other is listed under Not done, in any near form → nothing", async (_l, w, request) => {
    const said = { en: "Countries stay a list, because a list cannot learn new values", "pt-BR": "Os países continuam em lista", de: "Das Land bleibt eine Liste", es: "El país sigue siendo una lista", it: "Il paese resta un elenco", pl: "Pole kraju pozostaje listą" }[_l]!;
    expect(await unanswered(w, request, change(cellar(w), asText(w, "grape")), [said])).toEqual([]);
  });

  it("a button named and not answered, beside one that was changed", async () => {
    const after = change(cellar(EN), ['await ctx.data.update("bottle", r.id, { drunk: true });', 'if (await ctx.ui.confirm("Sure?")) await ctx.data.update("bottle", r.id, { drunk: true });']);
    expect(await unanswered(EN, "Drink and Archive should both ask before doing anything", after)).toEqual(["Archive"]);
  });

  // What must NOT be asked about. Each is a whole, correct answer to its request; a name the request
  // uses is context there, or is answered by lines that speak of it.
  const WHOLE: Array<[string, Words, string, (src: string, w: Words) => string]> = [
    ["a single named part, changed", EN, "make Country free text", (s, w) => change(s, asText(w, "country"))],
    ["a single named part, and the edit is elsewhere", EN, "the Country picker is slow, show fewer rows on the list", (s) => change(s, ['view: { type: "list", entity: "bottle",', 'view: { type: "list", entity: "bottle", display: { primary: "name" },'])],
    ["two names, nothing redeclared: a new field beside them", EN, "add a rating next to Vintage and Price", (s) => change(s, ["        order:", '        rating: { type: "number", label: "Rating", min: 1, max: 5 },\n        order:'])],
    ["one redeclared, the other spoken of by the changed lines", EN, "make Tasting notes required and sort the list by Vintage", (s) => change(s, ["multiline: true }", "multiline: true, required: true }"], ["sort: (a, b) => a.name.localeCompare(b.name)", "sort: (a, b) => b.vintage - a.vintage"])],
    ["one redeclared, the other is the condition, read in a helper named after it", EN, "make Price optional when Vintage is empty", (s) => change(s, ['label: "Price", required: true', 'label: "Price"'], ["export default", "const hasVintage = (r: { vintage?: number }): boolean => r.vintage != null;\n\nexport default"])],
    ["the record's own name used for where", EN, "in each Winery, make Name optional", (s) => change(s, ['fields: { name: { type: "text", label: "Name" } }', 'fields: { name: { type: "text", label: "Name", required: false } }'])],
    ["a relation that goes by the record's name, beside a changed field", EN, "make Country free text for bottles of any Winery", (s, w) => change(s, asText(w, "country"))],
    ["pt-BR: one changed, the other in the new sort", PT, "Deixa Uva como texto livre e ordena por Safra", (s, w) => change(s, asText(w, "grape"), ["sort: (a, b) => a.name.localeCompare(b.name)", "sort: (a, b) => b.vintage - a.vintage"])],
    ["de: the second name is a new option's label", DE, "Rebsorte soll Freitext sein und Preis in Franken", (s, w) => change(s, asText(w, "grape"), ['label: "Preis", required: true', 'label: "Preis", currency: "CHF", required: true'])],
    ["es: both in one sentence, both changed", ES, "Uva y Región como texto libre", (s, w) => change(s, asText(w, "grape"), asText(w, "region"))],
    ["it: a renamed field counts as changed", IT, "Rinomina Annata in Anno e rendi Prezzo facoltativo", (s) => change(s, ['label: "Annata"', 'label: "Anno"'], ['label: "Prezzo", required: true', 'label: "Prezzo"'])],
    ["pl: the second is only where the first goes", PL, "Przenieś Rocznik pod Cena i zrób go wymaganym", (s) => change(s, ["min: 1900, integer: true }", "min: 1900, integer: true, required: true }"], ["        order:", "        // Rocznik sits under cena on the form\n        order:"])],
    ["a button changed, a field named as what it sets", EN, "Drink should also clear the Price", (s) => change(s, ["{ drunk: true }", "{ drunk: true, price: null }"])],
    ["the form's button changed, a field named as what it fills", EN, "Scan label should fill in the Vintage too", (s) => change(s, ['({ name: "x" })', '({ name: "x", vintage: 2020 })'])],
  ];

  it.each(WHOLE)("not asked: %s", async (_what, w, request, edit) => {
    expect(await unanswered(w, request, edit(cellar(w), w))).toEqual([]);
  });

  it("what sits behind a const is not read, and so not checked", async () => {
    const before = `const fields = { grape: { type: "enum", label: "Grape", options: ["a"] }, country: { type: "enum", label: "Country", options: ["b"] } };\nexport default defineApp({ entities: { bottle: { fields } }, pages: [] });`;
    const after = before.replace('{ type: "enum", label: "Grape", options: ["a"] }', '{ type: "text", label: "Grape" }');
    expect(unansweredParts("make Grape and Country free text", { before: await read(before), after: await read(after), said: [] })).toEqual([]);
  });

  it("the real modify requests, in three languages: one in 75 names two parts at all", async () => {
    const root = new URL("../../../", import.meta.url).pathname;
    const sourceOf = (app: string): string => {
      const path = [`examples/${app}.app.ts`, `examples/${app}.app.tsx`, `packages/generator/fixtures/${app}.app.ts`].find((p) => existsSync(root + p));
      if (!path) throw new Error(`no source for ${app}`);
      return readFileSync(root + path, "utf8");
    };
    let requests = 0;
    const could: string[] = [];
    for (const c of MODIFY_CASES) {
      const sw = await read(sourceOf(c.app));
      for (const language of ["en", ...EVAL_LANGUAGES] as const) {
        const request = language === "en" ? c.instruction : localizeModifyCase(c, language).instruction;
        requests += 1;
        if (mentionedParts(request, accusable(sw)).length >= 2) could.push(`${c.id} [${language}]`);
      }
    }
    expect(requests).toBe(MODIFY_CASES.length * 3);
    // The only requests the parts check can ever ask about. This one names "Name" (what a scan fills
    // in) and "When" (the conjunction, which is also a field's label): it is asked about only if an
    // edit redeclares one of the two and nothing in the changed lines speaks of the other.
    expect(could).toEqual(["plants-scan-barcode [en]"]);
  });
});

describe("a rule lifted from one field, left on its siblings", () => {
  // The request of #73: it names no field.
  const GENERIC = "do not cause an error when a field is not recognized; if it is recognized and the value does not exist in the list, add it";

  it("the issue's case: one list made free text, the lists of the same shape are named", async () => {
    const after = change(cellar(EN), asText(EN, "grape"));
    expect(await siblings(EN, GENERIC, after)).toEqual(["bottle.country", "bottle.region"]);
    const [fault] = liftedRules(await read(cellar(EN)), await read(after));
    expect(fault).toMatchObject({ entity: "bottle", lifted: "changed from an `enum` field to a `text` field and lost `options`", changed: [{ ref: "bottle.grape", name: "Grape" }] });
  });

  it("two of three changed: the third is named once", async () => {
    expect(await siblings(EN, GENERIC, change(cellar(EN), asText(EN, "grape"), asText(EN, "country")))).toEqual(["bottle.region"]);
  });

  it("all of them changed → nothing", async () => {
    expect(await siblings(EN, GENERIC, change(cellar(EN), asText(EN, "grape"), asText(EN, "country"), asText(EN, "region")))).toEqual([]);
  });

  it("a sibling the reply lists as not done is not named again", async () => {
    const after = change(cellar(EN), asText(EN, "grape"));
    expect(await siblings(EN, GENERIC, after, ["Country still takes only the countries in its list", "Regions too"])).toEqual([]);
  });

  it.each([
    ["en", EN, "make Grape free text"],
    ["en, inflected", EN, "let me type the grapes freely"],
    ["pt-BR", PT, "quero escrever qualquer uva"],
    ["pt-BR, inflected", PT, "quero escrever as uvas livremente"],
    ["de, inflected", DE, "bei Rebsorten will ich frei tippen"],
    ["es", ES, "la uva como texto libre"],
    ["it, inflected", IT, "i vitigni come testo libero"],
    ["pl, inflected", PL, "chcę wpisywać dowolne szczepy"],
  ])("a request that names the field that changed is about that field (%s) → nothing", async (_l, w, request) => {
    expect(await siblings(w, request, change(cellar(w), asText(w, "grape")))).toEqual([]);
  });

  it("`required` taken from one field: only the fields of that kind that still have it", async () => {
    const src = `export default defineApp({ entities: { guest: { fields: {
      first: { type: "text", label: "First name", required: true },
      last: { type: "text", label: "Last name", required: true },
      nick: { type: "text", label: "Nickname" },
      age: { type: "number", label: "Age", required: true },
    } } }, pages: [] });`;
    const after = src.replace('label: "First name", required: true', 'label: "First name"');
    const faults = siblingFaults("saving fails when I leave things empty, stop that", { before: await read(src), after: await read(after), said: [] });
    expect(faults).toEqual([{ entity: "guest", lifted: "lost `required`", changed: [{ ref: "guest.first", name: "First name" }], siblings: [{ ref: "guest.last", name: "Last name" }] }]);
  });

  // Not a rule lifted: nothing is asked.
  it.each([
    ["an option added to a list", (s: string) => change(s, ['["merlot", "syrah"]', '["merlot", "syrah", "malbec"]'])],
    ["a label changed", (s: string) => change(s, ['label: "Grape"', 'label: "Variety"'])],
    ["a rule added", (s: string) => change(s, [fieldLine(EN, "grape"), `${fieldLine(EN, "grape").slice(0, -2)}, required: true }`])],
    ["a new field", (s: string) => change(s, ["        order:", '        colour: { type: "enum", label: "Colour", options: ["red", "white"] },\n        order:'])],
    ["a bound moved, not removed", (s: string) => change(s, ["min: 1900", "min: 1800"])],
    ["a field removed", (s: string) => change(s, [`        ${fieldLine(EN, "grape")},\n`, ""])],
    ["a kind changed with no rule gone: text made a number", (s: string) => change(s, ['notes: { type: "text", label: "Tasting notes", multiline: true }', 'notes: { type: "number", label: "Tasting notes" }'])],
    ["a kind changed with no rule gone: one of a list made several of the same list", (s: string) => change(s, ['grape: { type: "enum"', 'grape: { type: "tags"'])],
  ])("%s → nothing", async (_what, edit) => {
    expect(await siblings(EN, GENERIC, edit(cellar(EN)))).toEqual([]);
  });

  it("a kind that changed is not compared across kinds of record, nor with a field of another shape", async () => {
    const src = `export default defineApp({ entities: {
      a: { fields: { tags: { type: "tags", label: "Tags", options: ["x"] }, free: { type: "tags", label: "Free tags" }, kind: { type: "enum", label: "Kind", options: ["k"] } } },
      b: { fields: { tags: { type: "tags", label: "Labels", options: ["y"] } } },
    }, pages: [] });`;
    const after = src.replace('tags: { type: "tags", label: "Tags", options: ["x"] }', 'tags: { type: "text", label: "Tags" }');
    expect(liftedRules(await read(src), await read(after))).toEqual([]);
  });
});

describe("what the model is told", () => {
  it("names each part with where it is, and each sibling with what was lifted", async () => {
    const before = await read(cellar(EN));
    const after = await read(change(cellar(EN), asText(EN, "grape")));
    const parts = partsNote(unansweredParts("make Grape and Country free text", { before, after, said: [] }), "Not done:");
    expect(parts).toBe('The request names these parts of the app. Your change does not touch them, and nothing under "Not done:" speaks of them:\n- "Country": the field bottle.country');
    const sibs = siblingsNote(siblingFaults("stop failing on values that are not in the list", { before, after, said: [] }));
    expect(sibs).toBe('In your change, "Grape" (bottle.grape) changed from an `enum` field to a `text` field and lost `options`. Left exactly as they were, with the same shape: "Country" (bottle.country), "Region" (bottle.region).');
  });
});
