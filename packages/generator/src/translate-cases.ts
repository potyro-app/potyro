// The `eval:translate` cases (docs/20 §5.3) and, for each, a good and a bad answer written by hand,
// so the scorer can be checked without a model (`--fixture`, and test/translate-eval.test.ts).
//
// Apps come from examples/ as the release ships them; the en+pl+de app is groceries with German
// spliced in by the same `spliceLanguage` the tool uses.

import { readSourceWords, sourceSlots, spliceLanguage } from "./source-words.js";
import type { TranslateCase } from "./translate-eval.js";

/** Reads an example app's source by file name. Node supplies `fs`; tests pass their own. */
export type ReadExample = (file: string) => string;

export const EXAMPLE_APPS = ["groceries.app.ts", "plants.app.ts", "places.app.ts", "recipes.app.tsx", "split.app.ts", "workout.app.tsx"] as const;

/** Fake German for a fixture: marked, so it never equals the English. */
const fakeDe = (en: string): string => `DE ${en}`;

/** The `ctx.t` maps of a source with a fake German beside their English — the edits a model would add. */
const tMapsInGerman = (source: string): string => source.replace(/ctx\.t\(\{ en: ("(?:[^"\\]|\\.)*") \}/g, (_all, en: string) => `ctx.t({ en: ${en}, de: ${JSON.stringify(fakeDe(JSON.parse(en) as string))} }`);

/** Every literal slot of `source`, in a fake `lang` — the shape of a complete answer to `translate`. */
async function everyWord(source: string, lang: (en: string) => string): Promise<Record<string, string>> {
  const sw = await readSourceWords(source);
  const words: Record<string, string> = {};
  for (const s of sw ? sourceSlots(sw) : []) {
    if (s.kind !== "literal") continue;
    const en = s.suggested ?? (typeof s.value === "string" ? s.value : (s.value?.en ?? Object.values(s.value ?? {})[0] ?? ""));
    words[s.path] = lang(en);
  }
  return words;
}

/** groceries in en, pl and de. */
export async function groceriesThreeLanguages(read: ReadExample): Promise<string> {
  const source = read("groceries.app.ts");
  return (await spliceLanguage(source, "de", await everyWord(source, fakeDe))).source;
}

export interface CaseWithFixtures {
  case: TranslateCase;
  /** An answer that should pass, and one that should fail — for the scorer's own test. */
  good: () => Promise<string>;
  bad: () => Promise<string>;
}

const QUANTITY = `label: { en: "Quantity", pl: "Ilość" }`;

export async function translateCases(read: ReadExample): Promise<CaseWithFixtures[]> {
  const groceries = read("groceries.app.ts");
  const three = await groceriesThreeLanguages(read);
  const quantityThree = /label: \{ en: "Quantity", pl: "Ilość", de: "DE Quantity" \}/;

  const translateCase = (file: string): CaseWithFixtures => ({
    case: { id: `translate-${file.split(".")[0]}-de`, kind: "translate", app: read(file), instruction: "Translate this app into German", language: "de" },
    good: async () => tMapsInGerman((await spliceLanguage(read(file), "de", await everyWord(read(file), fakeDe))).source),
    bad: async () => {
      const all = Object.entries(await everyWord(read(file), fakeDe));
      return (await spliceLanguage(read(file), "de", Object.fromEntries(all.slice(0, Math.ceil(all.length / 2))))).source;
    },
  });

  return [
    ...EXAMPLE_APPS.map(translateCase),
    {
      case: {
        id: "rename-quantity",
        kind: "rename",
        app: three,
        instruction: "Rename the Quantity label to Amount",
        slot: "entities.item.fields.quantity.label",
        expect: { en: "Amount" },
      },
      good: async () => three.replace(quantityThree, `label: { en: "Amount", pl: "Liczba", de: "Betrag" }`),
      bad: async () => three.replace(quantityThree, `label: { en: "Amount", pl: "Ilość", de: "DE Quantity" }`),
    },
    {
      case: {
        id: "one-language",
        kind: "one-lang",
        app: groceries,
        instruction: "Make the Polish say 'Liczba' instead",
        slot: "entities.item.fields.quantity.label",
        expect: { pl: "Liczba" },
      },
      good: async () => groceries.replace(QUANTITY, `label: { en: "Quantity", pl: "Liczba" }`),
      bad: async () => groceries.replace(QUANTITY, `label: { en: "Amount", pl: "Liczba" }`),
    },
    {
      case: { id: "add-due-date", kind: "add-field", app: groceries, instruction: "Add a due date to items", entity: "item" },
      good: async () => groceries.replace(`        note: { type: "text"`, `        due: { type: "datetime", label: { en: "Due", pl: "Termin" } },\n        note: { type: "text"`),
      bad: async () => groceries.replace(`        note: { type: "text"`, `        due: { type: "datetime", label: { en: "Due" } },\n        note: { type: "text"`),
    },
    {
      case: { id: "polish-request", kind: "polish-ask", app: groceries, instruction: "dodaj pole notatki do działu", entity: "aisle" },
      good: async () => groceries.replace(`        order: { type: "number"`, `        note: { type: "text", label: { en: "Note", pl: "Notatka" } },\n        order: { type: "number"`),
      bad: async () => groceries.replace(`        order: { type: "number"`, `        note: { type: "text", label: "Notatka" },\n        order: { type: "number"`),
    },
  ];
}
