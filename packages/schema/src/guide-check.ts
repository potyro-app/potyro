// A guide that names a button the app does not have (#80).
//
// An app's guide is written with the app and has to stay true when the app changes: "Tap “Scan
// label” on the Bottles page" is worse than no guide once the button is called something else. The
// names a step puts in quotes are the checkable part, so the candidate run (run-candidate.ts) reads
// them and says which of them nothing in the app is called — a warning, in words a model can act on.
//
// What a name is checked against: every word the app declares (page and section titles, page
// buttons, quick actions, record actions, kinds of record, field, option and filter labels — the
// schema's own list of words slots, so it cannot drift), the names the shell makes from a key when no
// label is written ("dueDate" → "Due date"), and, failing those, the app's source outside the guide:
// a button drawn by a custom view, or a label from `ctx.t`, is a string there and nowhere else.
// Checked in the language the app is written in; its catalogs translate the steps and the names
// alike, from the same source text. A step that quotes nothing passes.
//
// Apart from guide.ts, which the validator imports: this file reads the app through the words walker,
// which itself needs the validator's schema.

import { humanizeKey } from "./humanize.js";
import type { Words } from "./types/words.js";
import { wordSlots } from "./words.js";
import { isContextWords, isWordsMap } from "./words-schema.js";

/** “…”, „…“ / „…”, «…» and "…": the quotation marks of the languages the Studio speaks. Never '…': an apostrophe. */
const QUOTED = /„([^“”„]+)[“”]|“([^”“]+)”|«\s*([^»]+?)\s*»|"([^"]+)"/g;

/** A name as it is compared: case, spacing, and what surrounds the letters (an emoji, "…", ":") set aside. */
const norm = (s: string): string =>
  s
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

interface Def {
  language?: string;
  guide?: unknown;
  entities?: Record<string, { label?: unknown; fields?: Record<string, { options?: unknown }>; actions?: Record<string, unknown>; computed?: Record<string, unknown> } | undefined>;
  pages?: Array<{ id?: unknown } | undefined>;
}

/** Words in the language the app is written in. */
function own(words: Words, language: string | undefined): string {
  if (typeof words === "string") return words;
  if (isContextWords(words)) return words.text;
  if (!isWordsMap(words)) return "";
  return (language && words[language]) || Object.values(words).find((v) => typeof v === "string") || "";
}

/** Every name the app shows by declaration, normalised; and its kinds of record, for "Add: Bottle". */
function declaredNames(def: Def): { names: Set<string>; kinds: Set<string> } {
  const names = new Set<string>();
  const kinds = new Set<string>();
  const add = (s: unknown, to: Set<string> = names): void => {
    const n = typeof s === "string" ? norm(s) : "";
    if (n) to.add(n);
  };
  for (const { path, value } of wordSlots(def)) if (path[0] !== "guide") add(own(value, def.language));
  for (const page of def.pages ?? []) if (typeof page?.id === "string") add(humanizeKey(page.id));
  for (const [key, entity] of Object.entries(def.entities ?? {})) {
    const label = typeof entity?.label === "string" ? entity.label : entity?.label ? own(entity.label as Words, def.language) : humanizeKey(key);
    add(label);
    add(label, kinds);
    add(humanizeKey(key));
    add(humanizeKey(key), kinds);
    for (const [field, f] of Object.entries(entity?.fields ?? {})) {
      add(humanizeKey(field));
      if (Array.isArray(f?.options)) for (const o of f.options) add(typeof o === "string" ? humanizeKey(o) : "");
    }
    for (const k of [...Object.keys(entity?.actions ?? {}), ...Object.keys(entity?.computed ?? {})]) add(humanizeKey(k));
  }
  return { names, kinds };
}

/** The source without the guide's own words, as a string would be written there. */
function sourceOutsideGuide(source: string, steps: readonly string[]): string {
  let rest = source;
  for (const step of steps) {
    for (const written of new Set([step, JSON.stringify(step).slice(1, -1), step.replace(/'/g, "\\'")])) rest = rest.split(written).join("");
  }
  return rest.toLocaleLowerCase();
}

/**
 * The names a guide's steps quote that nothing in the app is called. `definition` is the app as it
 * declares itself (not localized); `source`, when given, is searched for names only code shows.
 */
export function guideProblems(definition: unknown, source?: string): string[] {
  const def = (definition ?? {}) as Def;
  if (!Array.isArray(def.guide)) return [];
  const steps = def.guide.map((s) => own(s as Words, def.language));
  if (!steps.some((s) => QUOTED.test(s))) {
    QUOTED.lastIndex = 0;
    return [];
  }
  QUOTED.lastIndex = 0;
  const { names, kinds } = declaredNames(def);
  const code = source ? sourceOutsideGuide(source, steps) : "";
  const known = (quoted: string): boolean => {
    const name = norm(quoted);
    if (!name || names.has(name)) return true;
    // The shell's own add button for a kind of record: "Add: Bottle", in whatever language the shell speaks.
    const adds = /^[^:]+:\s*(.+)$/.exec(name);
    if (adds && kinds.has(norm(adds[1]!))) return true;
    return code !== "" && code.includes(quoted.trim().toLocaleLowerCase());
  };
  const problems: string[] = [];
  steps.forEach((step, i) => {
    for (const m of step.matchAll(QUOTED)) {
      const quoted = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim();
      if (!quoted || known(quoted)) continue;
      problems.push(
        `the guide's step ${i + 1} names “${quoted}”, which no page, button or field of the app is called — a step quotes only what the app shows, as it is written there: use the real name, or say it without quotes`,
      );
    }
  });
  return [...new Set(problems)];
}
