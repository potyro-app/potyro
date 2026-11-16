// Was every part of the request answered? (#73)
//
// A change that passes every gate can still be half of what was asked: "make Grape and Country free
// text" answered with an edit to Grape and not a word about Country. Nothing in compile, validate or
// run can see that. Two checks here can, both over the app's OWN structure as its source declares it
// (`readSourceWords`), never over a list of words:
//
//   - PARTS. When the request names two or more fields or buttons by the words the app shows for
//     them, and the edit changed the declaration of at least one, each of the others must have been
//     answered too: by the edit (its declaration changed, or the changed lines speak of it) or by a
//     line under `Not done:` / `Assumed:`. One that has neither is "unanswered". A request done in
//     part is exactly that shape; a request whose named parts were all left alone used their names
//     to say where or what about ("add a rating to each recipe"), and is not asked about.
//   - SIBLINGS. When the edit lifted a rule from a field — `required`, `options`, `min`, `max`,
//     `integer` or `accept` went away, with or without its kind changing (a list made free text) —
//     the fields of the same kind in the same record that still have that rule, untouched, are
//     named. Only when the request did not name the field that changed: a request about one named
//     field is about that field.
//
// Both only ever cost one question to the model (modify-loop.ts asks once and the accepted change
// stands whatever comes back), so the matching leans one way on purpose:
//
//   - ACCUSING is strict: a part counts as named only when the request holds the app's words for it
//     exactly, word for word after folding case and accents. An inflected form ("countries" for
//     "Country", "krajów" for "Kraj", "Ländern" for "Land") is not a match, and that request is simply
//     not checked. So is a request in a language the app's words are not written in.
//   - EXCUSING is loose: the edit or a `Not done:` line answers a part when it holds its words or its
//     key in any near form (a shared stem, a plural), anywhere in the changed lines.
//
// Entities and pages are left out as parts: a request names them to say WHERE ("on the Cellar page"),
// and whether the change belongs there is not something structure can tell. For the same reason a
// field that goes by the name of a kind of record (the `recipe` relation of a meal) is never accused:
// on the real modify requests (modify-corpus.ts, in three languages) those were most of what a
// request "named", and every one of them was the record, not the field.

import { humanizeKey } from "potyro";
import { CODE, FN, type SourceWords } from "./source-words.js";

export type PartKind = "field" | "action" | "fill";

/** A part of the app a person can name: a field, or a button (an action, a form's fill, a page's button). */
export interface AppPart {
  kind: PartKind;
  /** Stable across an edit: `bottle.country`, `bottle.actions.archive`, `bottle.fill:Scan label`, `page:cellar.actions:Scan`. */
  ref: string;
  /** Where its declaration sits in the source's definition (`SourceWords.nodes`). */
  path: string;
  /** Its key in the app, where it has one of its own (a field, a record's action). */
  key?: string;
  /** The words the app shows for it, as written: its label in every language the source carries, or its key made readable. */
  names: string[];
}

type Data = Record<string, unknown>;
const isData = (v: unknown): v is Data => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v !== CODE && v !== FN && v.trim() !== "";

/** The strings of a `Words` value as the source wrote it: a string, `{ text, context }`, or a map per language. */
function wordsIn(value: unknown): string[] {
  if (isText(value)) return [value];
  if (!isData(value)) return [];
  if (isText(value.text) && "context" in value) return [value.text];
  return Object.values(value).filter(isText);
}

/** The words a part goes by: its label as written; its key made readable when it has none; nothing when the label is code (a const, a helper) that cannot be read. */
const namesOf = (label: unknown, key: string): string[] => {
  if (label === undefined) return [humanizeKey(key)];
  return [...new Set(wordsIn(label))];
};

/** Every field and button the source declares as data. What sits behind a const or a helper is not seen, and so never checked. */
export function appParts(sw: SourceWords): AppPart[] {
  const out: AppPart[] = [];
  const entities = isData(sw.data.entities) ? sw.data.entities : {};
  for (const [entity, def] of Object.entries(entities)) {
    if (!isData(def)) continue;
    const at = `entities.${entity}`;
    if (isData(def.fields)) {
      for (const [key, field] of Object.entries(def.fields)) {
        if (!isData(field) || field.hidden === true) continue;
        out.push({ kind: "field", ref: `${entity}.${key}`, path: `${at}.fields.${key}`, key, names: namesOf(field.label, key) });
      }
    }
    if (isData(def.actions)) {
      for (const [key, action] of Object.entries(def.actions)) {
        out.push({ kind: "action", ref: `${entity}.actions.${key}`, path: `${at}.actions.${key}`, key, names: namesOf(isData(action) ? action.label : undefined, key) });
      }
    }
    if (Array.isArray(def.fill)) {
      def.fill.forEach((fill, i) => {
        const names = isData(fill) ? wordsIn(fill.label) : [];
        if (names.length) out.push({ kind: "fill", ref: `${entity}.fill:${names[0]}`, path: `${at}.fill.${i}`, names });
      });
    }
  }
  const pages = Array.isArray(sw.data.pages) ? sw.data.pages : [];
  pages.forEach((page, p) => {
    if (!isData(page) || !Array.isArray(page.actions)) return;
    const id = isText(page.id) ? page.id : String(p);
    page.actions.forEach((action, i) => {
      const names = isData(action) ? wordsIn(action.label) : [];
      if (names.length) out.push({ kind: "action", ref: `page:${id}.actions:${names[0]}`, path: `pages.${p}.actions.${i}`, names });
    });
  });
  return out;
}

// ---- words ----

/**
 * A text as words: case and accents folded, identifiers split where their case changes (`isToday` is
 * "is", "today"), everything that is not a letter or a digit a break. Works for every script that
 * writes spaces between words; a text without them (Chinese, Japanese, Thai) is one word and matches
 * nothing, so it is never checked.
 */
export function wordsOf(text: string): string[] {
  const split = text.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2");
  return split.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** A name worth matching: at least three letters in all, and not only digits. */
const usable = (words: readonly string[]): boolean => words.join("").length >= 3 && words.some((w) => /\p{L}/u.test(w));

/** Two words that are the same word in a near form: equal, or sharing a stem ("country"/"countries", "kraj"/"kraju"). Only ever used to EXCUSE. */
export function near(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.length - short.length > 3) return false;
  let shared = 0;
  while (shared < short.length && short[shared] === long[shared]) shared += 1;
  if (shared === short.length) return short.length >= 3;
  return shared >= Math.max(4, short.length - 2);
}

/** Where `needle` occurs in `hay` as a run of words: each `[start, end)`. */
function runs(hay: readonly string[], needle: readonly string[], same: (a: string, b: string) => boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!needle.length) return out;
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    if (needle.every((w, k) => same(hay[i + k]!, w))) out.push([i, i + needle.length]);
  }
  return out;
}

const exact = (a: string, b: string): boolean => a === b;
const holds = (hay: readonly string[], needle: readonly string[]): boolean => usable(needle) && runs(hay, needle, near).length > 0;

/** Does a text speak of the part, in any near form of its words or its key? The loose side: for excusing only. */
function speaksOf(words: readonly string[], part: AppPart): boolean {
  return part.names.some((n) => holds(words, wordsOf(n))) || (part.key !== undefined && holds(words, wordsOf(part.key)));
}

// ---- parts the request names ----

/** A part of the request: words of it that are the app's words for one or more of its parts. */
export interface Mention {
  /** The app's words, as the app writes them. */
  name: string;
  /** Every part that goes by those words (a "Name" field on two kinds of record): answering any of them answers the mention. */
  parts: AppPart[];
}

/**
 * The parts of the app the request names, by the exact words the app shows for them. A name inside a
 * longer name that also matched ("Notes" inside "Tasting notes") is not a mention of its own.
 */
export function mentionedParts(instruction: string, parts: readonly AppPart[]): Mention[] {
  const said = wordsOf(instruction);
  const found: Array<{ key: string; name: string; part: AppPart; span: [number, number] }> = [];
  for (const part of parts) {
    for (const name of part.names) {
      const words = wordsOf(name);
      if (!usable(words)) continue;
      for (const span of runs(said, words, exact)) found.push({ key: words.join(" "), name, part, span });
    }
  }
  const inside = (a: [number, number], b: [number, number]): boolean => b[0] <= a[0] && a[1] <= b[1] && b[1] - b[0] > a[1] - a[0];
  const kept = found.filter((f) => !found.some((g) => inside(f.span, g.span)));
  const byName = new Map<string, Mention>();
  for (const f of kept) {
    const m = byName.get(f.key) ?? { name: f.name, parts: [] };
    if (!m.parts.includes(f.part)) m.parts.push(f.part);
    byName.set(f.key, m);
  }
  return [...byName.values()];
}

// ---- what an edit touched ----

const textAt = (sw: SourceWords, path: string): string | null => {
  const node = sw.nodes.get(path);
  return node ? sw.source.slice(node.start, node.end) : null;
};

/** The lines only one of the two sources has, as words: what the edit wrote and what it took out. */
export function changedWords(before: string, after: string): string[] {
  const count = (text: string): Map<string, number> => {
    const lines = new Map<string, number>();
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line) lines.set(line, (lines.get(line) ?? 0) + 1);
    }
    return lines;
  };
  const [was, is] = [count(before), count(after)];
  const out: string[] = [];
  for (const [line, n] of is) if (n > (was.get(line) ?? 0)) out.push(line);
  for (const [line, n] of was) if (n > (is.get(line) ?? 0)) out.push(line);
  return wordsOf(out.join("\n"));
}

export interface Answered {
  before: SourceWords;
  after: SourceWords;
  /** The reply's `Not done:` and `Assumed:` lines. */
  said: readonly string[];
}

/** The same part in the candidate, by its `ref`; its declaration there, or null when it is gone. */
function declarationsAfter(after: SourceWords): Map<string, string | null> {
  return new Map(appParts(after).map((p) => [p.ref, textAt(after, p.path)]));
}

/** What the app calls its kinds of record: each entity's key and label, as words. */
function entityNames(sw: SourceWords): string[][] {
  const entities = isData(sw.data.entities) ? sw.data.entities : {};
  return Object.entries(entities).flatMap(([key, def]) => [wordsOf(key), ...(isData(def) ? wordsIn(def.label).map(wordsOf) : [])]);
}

/** The parts that may be accused: not one that goes by the name of a kind of record, in any near form. */
export function accusable(sw: SourceWords): AppPart[] {
  const records = entityNames(sw);
  const sameWords = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((w, i) => near(w, b[i]!));
  return appParts(sw)
    .map((part) => ({ ...part, names: part.names.filter((n) => !records.some((r) => sameWords(wordsOf(n), r))) }))
    .filter((part) => part.names.length > 0);
}

/**
 * The parts the request names that the reply answered in no way — no edit to them, nothing of them in
 * the changed lines, no `Not done:` or `Assumed:` line about them — while the declaration of another
 * part it names WAS changed. Without that, nothing: the names were not a list of things to change.
 */
export function unansweredParts(instruction: string, a: Answered): Mention[] {
  const mentions = mentionedParts(instruction, accusable(a.before));
  if (mentions.length < 2) return [];
  const now = declarationsAfter(a.after);
  const redeclared = (part: AppPart): boolean => now.get(part.ref) !== textAt(a.before, part.path);
  if (!mentions.some((m) => m.parts.some(redeclared))) return [];
  const changed = changedWords(a.before.source, a.after.source);
  const lines = a.said.map(wordsOf);
  const answered = (part: AppPart): boolean => {
    // Removed or renamed counts as changed; so does a declaration that no longer reads the same.
    if (redeclared(part)) return true;
    return speaksOf(changed, part) || lines.some((l) => speaksOf(l, part));
  };
  return mentions.filter((m) => !m.parts.some(answered));
}

// ---- the same fault, left in a field of the same shape ----

/** What makes a write to a field refused (packages/schema `fieldValueIssue`): the rules an edit can lift. */
const RULES = ["required", "options", "min", "max", "integer", "accept"] as const;
type Rule = (typeof RULES)[number];

const hasRule = (field: Data, rule: Rule): boolean => {
  const v = field[rule];
  if (rule === "required" || rule === "integer") return v === true;
  return v !== undefined && v !== null;
};

export interface FieldRef {
  ref: string;
  name: string;
}

/** A rule lifted from some fields of a record and still on others of the same shape. */
export interface SiblingFault {
  entity: string;
  /** What the edit did to them, in words for the model: `lost `required``, `changed from an `enum` field to a `text` field and lost `options``. */
  lifted: string;
  /** The fields the edit lifted it from. */
  changed: FieldRef[];
  /** The fields of the same shape it left as they were. */
  siblings: FieldRef[];
}

/**
 * Every rule the edit lifted from a field while fields of the same shape, in the same kind of record,
 * were left untouched. Same shape: the same kind of field, with every rule that was taken away still
 * on it (for a list made free text: an `enum` that still has its `options`).
 * Structure only: what the request asked for is weighed by the caller (`siblingFaults`).
 */
export function liftedRules(before: SourceWords, after: SourceWords): SiblingFault[] {
  const groups = new Map<string, SiblingFault>();
  const entities = isData(before.data.entities) ? before.data.entities : {};
  const entitiesAfter = isData(after.data.entities) ? after.data.entities : {};
  for (const [entity, def] of Object.entries(entities)) {
    const was = isData(def) && isData(def.fields) ? def.fields : null;
    const nowDef = entitiesAfter[entity];
    const now = isData(nowDef) && isData(nowDef.fields) ? nowDef.fields : null;
    if (!was || !now) continue;
    const refOf = (key: string): FieldRef => ({ ref: `${entity}.${key}`, name: namesOf((was[key] as Data).label, key)[0] ?? humanizeKey(key) });
    const untouched = (key: string): boolean => {
      const text = textAt(before, `entities.${entity}.fields.${key}`);
      return text !== null && text === textAt(after, `entities.${entity}.fields.${key}`);
    };
    for (const [key, fb] of Object.entries(was)) {
      const fa = now[key];
      if (!isData(fb) || !isData(fa) || !isText(fb.type) || !isText(fa.type)) continue;
      const kind = fb.type;
      // A kind that changes with no rule gone (text made a number, an enum made tags over the same
      // options) lifted nothing: it is a different change, and its neighbours are not asked about.
      const gone = RULES.filter((r) => hasRule(fb, r) && !hasRule(fa, r));
      if (!gone.length) continue;
      const siblings = Object.entries(was)
        .filter(([k, f]) => k !== key && isData(f) && f.hidden !== true && f.type === kind && untouched(k))
        .filter(([, f]) => gone.every((r) => hasRule(f as Data, r)))
        .map(([k]) => refOf(k));
      if (!siblings.length) continue;
      const lost = `lost ${gone.map((r) => `\`${r}\``).join(" and ")}`;
      const lifted = fa.type !== kind ? `changed from ${article(kind)} field to ${article(fa.type)} field and ${lost}` : lost;
      const id = `${entity}\u0000${kind}\u0000${lifted}`;
      const group = groups.get(id) ?? { entity, lifted, changed: [], siblings: [] };
      group.changed.push(refOf(key));
      for (const s of siblings) if (!group.siblings.some((g) => g.ref === s.ref)) group.siblings.push(s);
      groups.set(id, group);
    }
  }
  return [...groups.values()];
}

const article = (kind: string): string => `${/^[aeiou]/.test(kind) ? "an" : "a"} \`${kind}\``;

/**
 * The lifted rules worth naming to the model (#73): those where the request named none of the fields
 * that changed — a request about a named field is about that field — less the siblings a `Not done:`
 * or `Assumed:` line already speaks of. Whether the request names a field is asked loosely here (any
 * near form of its words): naming it is what EXCUSES the siblings.
 */
export function siblingFaults(instruction: string, a: Answered): SiblingFault[] {
  const asked = wordsOf(instruction);
  const lines = a.said.map(wordsOf);
  const parts = new Map(appParts(a.before).map((p) => [p.ref, p]));
  const spoken = (words: readonly string[], f: FieldRef): boolean => {
    const part = parts.get(f.ref);
    return part ? speaksOf(words, part) : false;
  };
  return liftedRules(a.before, a.after)
    .filter((fault) => !fault.changed.some((f) => spoken(asked, f)))
    .map((fault) => ({ ...fault, siblings: fault.siblings.filter((s) => !lines.some((l) => spoken(l, s))) }))
    .filter((fault) => fault.siblings.length > 0);
}

// ---- what the model is told ----

/** Names in a note, at most: a long list is not read. */
const MAX_NAMED = 5;
const KIND_WORDS: Record<PartKind, string> = { field: "the field", action: "the button", fill: "the form's button" };
const listed = (items: readonly string[]): string => {
  const shown = items.slice(0, MAX_NAMED);
  return `${shown.join(", ")}${items.length > shown.length ? `, and ${items.length - shown.length} more` : ""}`;
};
const quote = (f: FieldRef): string => `"${f.name}" (${f.ref})`;

/** The parts section of the loop's one review note. English, like every word the model is given. */
export function partsNote(unanswered: readonly Mention[], notDone: string): string {
  const bullets = unanswered.slice(0, MAX_NAMED).map((m) => `- "${m.name}": ${m.parts.slice(0, 3).map((p) => `${KIND_WORDS[p.kind]} ${p.ref}`).join(", or ")}`);
  return [`The request names these parts of the app. Your change does not touch them, and nothing under "${notDone}" speaks of them:`, ...bullets].join("\n");
}

/** The siblings section of the loop's one review note. */
export function siblingsNote(faults: readonly SiblingFault[]): string {
  return faults
    .slice(0, MAX_NAMED)
    .map((f) => `In your change, ${listed(f.changed.map(quote))} ${f.lifted}. Left exactly as ${f.siblings.length === 1 ? "it was, with the same shape" : "they were, with the same shape"}: ${listed(f.siblings.map(quote))}.`)
    .join("\n");
}
