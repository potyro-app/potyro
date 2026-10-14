// The `eval:translate` cases (docs/20 §5.3) and, for each, a good and a bad answer written by hand,
// so the scorer can be checked without a model (`--fixture`, and test/translate-eval.test.ts).
//
// Apps come from examples/ as the release ships them. Since #303 every example carries the six
// languages the shell ships (en, pt-BR, de, es, pl, it), so "translate this app" asks for a seventh,
// French: an app may declare any language (docs/20 §1.3), and adding one to an app that already
// carries six is the harder case — every map the model touches must keep all the others. The
// rename, one-language and add-field cases run on groceries in all six.

import { readSourceWords, sourceSlots, spliceLanguage } from "./source-words.js";
import type { TranslateCase } from "./translate-eval.js";

/** Reads an example app's source by file name. Node supplies `fs`; tests pass their own. */
export type ReadExample = (file: string) => string;

export const EXAMPLE_APPS = ["groceries.app.ts", "plants.app.ts", "places.app.ts", "recipes.app.tsx", "split.app.ts", "workout.app.tsx"] as const;

/** The language the translate cases ask for: one no example carries. */
export const TRANSLATE_TO = "fr";

/** Fake French for a fixture: marked, so it never equals the English. */
const fakeFr = (en: string): string => `FR ${en}`;

interface Node {
  type: string;
  start: number;
  end: number;
  [k: string]: unknown;
}

/**
 * The `ctx.t({ … })` maps of a source with a fake French after their last language — the edits a
 * model would add. Read from the parsed source, so a map on one line or on six is found the same.
 */
async function tMapsInFrench(source: string): Promise<string> {
  const sw = await readSourceWords(source);
  if (!sw) return source;
  const inserts: Array<{ at: number; text: string }> = [];
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const node = n as Node;
    if (node.type === "CallExpression") {
      const callee = node.callee as Node & { property?: { name?: string } };
      const arg = (node.arguments as Node[] | undefined)?.[0];
      if (callee?.type === "MemberExpression" && callee.property?.name === "t" && arg?.type === "ObjectExpression") {
        const props = arg.properties as Array<Node & { key?: { name?: string; value?: string }; value?: Node & { value?: unknown } }>;
        const en = props.find((p) => (p.key?.name ?? p.key?.value) === "en")?.value;
        const last = props[props.length - 1];
        if (last && en?.type === "StringLiteral" && typeof en.value === "string") inserts.push({ at: last.end, text: `, fr: ${JSON.stringify(fakeFr(en.value))}` });
      }
    }
    for (const [k, value] of Object.entries(node)) {
      if (k === "loc") continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object" && (value as Node).type) visit(value);
    }
  };
  visit(sw.ast);
  let out = source;
  for (const { at, text } of inserts.sort((a, b) => b.at - a.at)) out = out.slice(0, at) + text + out.slice(at);
  return out;
}

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

export interface CaseWithFixtures {
  case: TranslateCase;
  /** An answer that should pass, and one that should fail — for the scorer's own test. */
  good: () => Promise<string>;
  bad: () => Promise<string>;
}

/** Groceries' Quantity label, as it ships: one line, the six languages. */
export const QUANTITY = `label: { en: "Quantity", "pt-BR": "Quantidade", de: "Menge", es: "Cantidad", pl: "Ilość", it: "Quantità" }`;

/** A label in all six of groceries' languages. */
const six = (en: string, ptBR: string, de: string, es: string, pl: string, it: string): string =>
  `{ en: ${JSON.stringify(en)}, "pt-BR": ${JSON.stringify(ptBR)}, de: ${JSON.stringify(de)}, es: ${JSON.stringify(es)}, pl: ${JSON.stringify(pl)}, it: ${JSON.stringify(it)} }`;

export async function translateCases(read: ReadExample): Promise<CaseWithFixtures[]> {
  const groceries = read("groceries.app.ts");
  if (!groceries.includes(QUANTITY)) throw new Error("groceries.app.ts no longer has the Quantity label the rename cases are written against");

  const translateCase = (file: string): CaseWithFixtures => ({
    case: { id: `translate-${file.split(".")[0]}-${TRANSLATE_TO}`, kind: "translate", app: read(file), instruction: "Translate this app into French", language: TRANSLATE_TO },
    good: async () => tMapsInFrench((await spliceLanguage(read(file), TRANSLATE_TO, await everyWord(read(file), fakeFr))).source),
    bad: async () => {
      const all = Object.entries(await everyWord(read(file), fakeFr));
      return (await spliceLanguage(read(file), TRANSLATE_TO, Object.fromEntries(all.slice(0, Math.ceil(all.length / 2))))).source;
    },
  });

  return [
    ...EXAMPLE_APPS.map(translateCase),
    {
      case: {
        id: "rename-quantity",
        kind: "rename",
        app: groceries,
        instruction: "Rename the Quantity label to Amount",
        slot: "entities.item.fields.quantity.label",
        expect: { en: "Amount" },
      },
      good: async () => groceries.replace(QUANTITY, `label: ${six("Amount", "Valor", "Betrag", "Importe", "Liczba", "Importo")}`),
      // English only: the other five still say Quantity.
      bad: async () => groceries.replace(QUANTITY, QUANTITY.replace(`en: "Quantity"`, `en: "Amount"`)),
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
      good: async () => groceries.replace(QUANTITY, QUANTITY.replace(`pl: "Ilość"`, `pl: "Liczba"`)),
      bad: async () => groceries.replace(QUANTITY, QUANTITY.replace(`pl: "Ilość"`, `pl: "Liczba"`).replace(`en: "Quantity"`, `en: "Amount"`)),
    },
    {
      case: { id: "add-due-date", kind: "add-field", app: groceries, instruction: "Add a due date to items", entity: "item" },
      good: async () =>
        groceries.replace(`        note: {\n          type: "text"`, `        due: { type: "datetime", label: ${six("Due", "Prazo", "Fällig am", "Fecha límite", "Termin", "Scadenza")} },\n        note: {\n          type: "text"`),
      bad: async () => groceries.replace(`        note: {\n          type: "text"`, `        due: { type: "datetime", label: { en: "Due" } },\n        note: {\n          type: "text"`),
    },
    {
      case: { id: "polish-request", kind: "polish-ask", app: groceries, instruction: "dodaj pole notatki do działu", entity: "aisle" },
      good: async () =>
        groceries.replace(
          `        order: { type: "number"`,
          `        note: { type: "text", label: ${six("Note", "Observação", "Notiz", "Nota", "Notatka", "Nota")} },\n        order: { type: "number"`,
        ),
      bad: async () => groceries.replace(`        order: { type: "number"`, `        note: { type: "text", label: "Notatka" },\n        order: { type: "number"`),
    },
  ];
}
