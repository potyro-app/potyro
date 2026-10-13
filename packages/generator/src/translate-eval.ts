// `eval:translate` (#302, docs/20 §5.3): does a model keep an app's languages in step?
//
// Five kinds of request, each scored WITHOUT a judge model — by reading the app before and after:
//
//   translate   "Translate this app into German": it compiles and validates; every words slot and
//               ctx.t map has `de`; in English it reads exactly as before; its shape is untouched;
//               and fewer than 10% of the German strings equal their English (it really translated)
//   rename      "Rename the Quantity label to Amount" (en+pl+de): that slot changed in all three, no
//               other slot changed
//   add-field   "Add a due date to items" (en+pl): the new field has en and pl; no new gaps
//   one-lang    "Make the Polish say 'Ilość' instead": only pl of that slot changed
//   polish-ask  a request in Polish on an en-default app: new words in BOTH en and pl; default stays en
//
// A translation, a rename and a one-language edit must show no data change: `schemaVersion` does not
// move. Adding a field IS a data change — docs/06: the migration is keyed off `version`, and the
// prompt bumps `schemaVersion` with it — so add-field and polish-ask may bump it.
//
// Words that are the same in every language on purpose are not held against a translation (docs/20
// §10): units in a `unit` slot ("kg", "kcal", "$/kg"), and any word of three letters or fewer with no
// space ("g", "ml", "min"). Placeholders are examples ("Shakshuka", a dish's own name), so they are
// left out of the "really translated" count, though they still need the language. That count is a
// cheap proxy for "it actually translated": under 10% of the PHRASES may read the same, and under 25%
// of all the words — single words are often the same on purpose ("Name", "Winter" in German).

import { humanizeKey, localize, wordGaps, wordSlots, wordsPathText, type AppDefinition, type Field, type Words } from "potyro";
import { readSourceWords, sourceLanguages, sourceSlots, tMapGaps } from "./source-words.js";

export type TranslateKind = "translate" | "rename" | "add-field" | "one-lang" | "polish-ask";

export interface TranslateCase {
  id: string;
  kind: TranslateKind;
  /** The app the request is made on (an example app's source, or one derived from it). */
  app: string;
  instruction: string;
  /** translate: the language asked for. */
  language?: string;
  /** rename / one-lang: the slot asked about, and what it must now read. */
  slot?: string;
  expect?: Partial<Record<string, string>>;
  /** add-field: the entity a field is added to. */
  entity?: string;
}

export interface TranslateScore {
  id: string;
  passed: boolean;
  /** Each check, in words: what held and what did not. */
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
}

/** The app as plain data, functions dropped — enough to compare words and shape. */
export type LoadDefinition = (source: string) => Promise<AppDefinition>;

const plainJson = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === "function" ? "ƒ" : x));

/** Every slot's words by path. */
function slotsByPath(def: AppDefinition): Map<string, Words> {
  return new Map(wordSlots(def).map((s) => [wordsPathText(s.path), s.value]));
}

/** What an app STORES and SHOWS, words aside: entities and their fields' keys and types, pages and views. */
function shapeOf(def: AppDefinition): string {
  const entities = Object.fromEntries(
    Object.entries(def.entities).map(([k, e]) => [k, Object.fromEntries(Object.entries(e.fields).map(([f, d]) => [f, [d.type, (d as { options?: unknown }).options ?? null]]))]),
  );
  const pages = def.pages.map((p) => [p.id, p.view?.type, (p.view as { entity?: string } | undefined)?.entity, p.layout?.items.length ?? 0]);
  return JSON.stringify({ entities, pages, schemaVersion: def.schemaVersion });
}

/**
 * What a person reads, with the defaults written out: a field with no `label` reads as its key
 * humanised, an option with no `labels` entry as itself. A translation that adds `label: { en: "Name",
 * de: … }` where the app leaned on "Name" changes nothing in English, and must not count as a change.
 */
function asRead(def: AppDefinition): unknown {
  const fields = (fs: Record<string, Field>): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(fs).map(([k, f]) => {
        const out: Record<string, unknown> = { ...f, label: f.label ?? humanizeKey(k) };
        if ((f.type === "enum" || f.type === "tags") && f.options) out.labels = Object.fromEntries(f.options.map((o) => [o, f.labels?.[o] ?? o]));
        if (f.type === "list") out.of = fields(f.of);
        return [k, out];
      }),
    );
  return {
    ...def,
    languages: undefined,
    version: undefined,
    entities: Object.fromEntries(Object.entries(def.entities).map(([k, e]) => [k, { ...e, label: e.label ?? humanizeKey(k), fields: fields(e.fields) }])),
  };
}

/** A word that reads the same in every language on purpose: a unit, or a token of three letters or fewer. */
export function sameEverywhere(path: string, text: string): boolean {
  const t = text.trim();
  return (/\.unit$/.test(path) && /^\S{1,8}$/.test(t)) || /^\S{1,3}$/.test(t);
}

const text = (w: Words | undefined, lang: string): string | undefined => (w === undefined ? undefined : typeof w === "string" ? w : w[lang]);

/** Score one case: `before` and `after` are sources; `load` bundles and validates one. */
export async function scoreTranslate(c: TranslateCase, before: string, after: string, load: LoadDefinition): Promise<TranslateScore> {
  const checks: TranslateScore["checks"] = [];
  const check = (name: string, ok: boolean, detail?: string): void => void checks.push({ name, ok, ...(detail ? { detail } : {}) });
  let a: AppDefinition;
  let b: AppDefinition;
  try {
    a = await load(before);
  } catch (e) {
    return { id: c.id, passed: false, checks: [{ name: "the app before loads", ok: false, detail: String(e) }] };
  }
  try {
    b = await load(after);
    check("compiles and validates", true);
  } catch (e) {
    check("compiles and validates", false, e instanceof Error ? e.message.slice(0, 300) : String(e));
    return { id: c.id, passed: false, checks };
  }
  if (c.kind === "translate" || c.kind === "rename" || c.kind === "one-lang") {
    check("schemaVersion did not move", a.schemaVersion === b.schemaVersion, `${a.schemaVersion} → ${b.schemaVersion}`);
  }
  check("its own language did not change", (a.language ?? "en") === (b.language ?? a.language ?? "en"), `${a.language} → ${b.language}`);

  const sw = await readSourceWords(after);
  const langs = sw ? sourceLanguages(sw).languages : [];
  const before_ = slotsByPath(a);
  const after_ = slotsByPath(b);
  const own = b.language ?? "en";

  switch (c.kind) {
    case "translate": {
      const lang = c.language!;
      check(`${lang} is one of its languages`, langs.includes(lang), langs.join(", "));
      // Asked for a whole language, a plain string is a word not translated — unless it holds no words
      // (an emoji, "2 × 1 l", a unit).
      const untranslated = [...after_]
        .filter(([p, w]) => (typeof w === "string" ? /\p{L}{2,}/u.test(w) && !w.startsWith("__potyro") && !sameEverywhere(p, w) : !(lang in w)))
        .map(([p]) => p);
      // A field or option that leans on its key reads in English whatever the language: "Bought by".
      for (const s of sw ? sourceSlots(sw) : []) if (s.suggested !== undefined && /\p{L}{2,}/u.test(s.suggested)) untranslated.push(`${s.path} (no words; shows ${JSON.stringify(s.suggested)})`);
      check(`every words slot has ${lang}`, untranslated.length === 0, untranslated.slice(0, 5).join(", "));
      const tGaps = sw ? tMapGaps(sw, [lang]) : [];
      check(`every ctx.t map has ${lang}`, tGaps.length === 0, tGaps.slice(0, 3).map((g) => `line ${g.line}`).join(", "));
      const strip = (d: AppDefinition): string => plainJson(asRead(localize(d, own) as AppDefinition));
      check(`in ${own} it reads exactly as before`, strip(a) === strip(b));
      check("its shape is unchanged", shapeOf(a) === shapeOf(b));
      // A phrase that reads the same in both is untranslated; a single word often is a cognate
      // ("Name", "Winter", "Wiki" in German). So: under 10% of the phrases, under 25% of everything.
      let same = 0;
      let total = 0;
      let samePhrases = 0;
      let phrases = 0;
      const equal: string[] = [];
      for (const [p, w] of after_) {
        if (typeof w === "string" || /\.placeholder$/.test(p)) continue;
        const there = w[lang];
        if (there === undefined || (w[own] !== undefined && sameEverywhere(p, w[own]!))) continue;
        const phrase = /\s/.test((w[own] ?? "").trim());
        total += 1;
        if (phrase) phrases += 1;
        if (there === w[own]) {
          same += 1;
          if (phrase) samePhrases += 1;
          equal.push(JSON.stringify(there));
        }
      }
      check(
        `it really translated (under 10% of phrases and 25% of all ${lang} words equal ${own})`,
        total > 0 && (phrases === 0 || samePhrases / phrases < 0.1) && same / total < 0.25,
        `${samePhrases} of ${phrases} phrases, ${same} of ${total} in all${equal.length ? `: ${equal.slice(0, 8).join(", ")}` : ""}`,
      );
      break;
    }
    case "rename":
    case "one-lang": {
      const slot = c.slot!;
      const was = before_.get(slot);
      const now = after_.get(slot);
      for (const [lang, want] of Object.entries(c.expect ?? {})) check(`${slot} reads "${want}" in ${lang}`, text(now, lang) === want, `got ${JSON.stringify(text(now, lang))}`);
      if (c.kind === "rename") {
        for (const lang of langs) check(`${slot} changed in ${lang}`, text(now, lang) !== text(was, lang));
      } else {
        const changed = langs.filter((l) => text(now, l) !== text(was, l));
        check(`only ${Object.keys(c.expect ?? {}).join(", ")} changed`, changed.length === Object.keys(c.expect ?? {}).length && changed.every((l) => l in (c.expect ?? {})), changed.join(", "));
      }
      const others = [...after_.keys()].filter((p) => p !== slot && plainJson(after_.get(p)) !== plainJson(before_.get(p)));
      check("no other slot changed", others.length === 0, others.slice(0, 5).join(", "));
      break;
    }
    case "add-field":
    case "polish-ask": {
      const entity = c.entity!;
      const added = Object.keys(b.entities[entity]?.fields ?? {}).filter((f) => !(f in (a.entities[entity]?.fields ?? {})));
      check("a field was added", added.length > 0, added.join(", "));
      const want = c.kind === "polish-ask" ? ["en", "pl"] : langs;
      for (const f of added) {
        const label = after_.get(`entities.${entity}.fields.${f}.label`);
        const ok = label !== undefined && typeof label !== "string" && want.every((l) => typeof label[l] === "string" && label[l]!.trim() !== "");
        check(`the new field "${f}" has a label in ${want.join(" and ")}`, ok, JSON.stringify(label));
      }
      const newGaps = wordGaps(b).filter((g) => !wordGaps(a).some((x) => x.path === g.path));
      check("no new gaps", newGaps.length === 0, newGaps.map((g) => g.path).join(", "));
      if (c.kind === "polish-ask") check("its own language stays en", b.language === "en", String(b.language));
      break;
    }
  }
  return { id: c.id, passed: checks.every((x) => x.ok), checks };
}

/** One line per case, and the checks that failed under it. */
export function formatTranslateReport(scores: TranslateScore[]): string {
  const lines = [`${scores.filter((s) => s.passed).length} of ${scores.length} cases passed`, ""];
  for (const s of scores) {
    lines.push(`${s.passed ? "PASS" : "FAIL"}  ${s.id}`);
    for (const c of s.checks) if (!c.ok) lines.push(`        ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  return lines.join("\n");
}
