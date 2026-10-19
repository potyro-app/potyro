// An app's words in the person's language (#302, docs/20).
//
// Everything here works from ONE walker over `structureSchema`: it follows the Zod schema and the
// value side by side and stops at every `zWords` slot (words-schema.ts). The default-language
// check, `localize()`, the completeness report and the generator's `translate` tool all use it, so
// the list of slots that take words is the schema itself and cannot drift from what is enforced —
// the way `VIEW_FIELDS` is derived from the view schemas.

import { z } from "zod";
import type { AppDefinition } from "./types/app.js";
import type { Field } from "./types/fields.js";
import type { ContextWords, Language, Words } from "./types/words.js";
import type { Localized } from "./types/localized.js";
import { fieldSchema, structureSchema } from "./validate.js";
import { isContextWords, isWordsMap, isWordsSchema } from "./words-schema.js";

/** Where a slot sits, as Zod writes paths: `["pages", 0, "title"]`. */
export type WordsPath = ReadonlyArray<string | number>;

/** Return replacement words for a slot, or `undefined` to leave it as it is. */
export type WordsVisitor = (value: Words, path: WordsPath) => Words | undefined;

type AnyDef = { typeName?: string } & Record<string, unknown>;

const isPlainObject = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

/** Which member of a union a value is: the first that accepts it, else the first of its kind. */
function unionMember(options: readonly z.ZodTypeAny[], value: unknown): z.ZodTypeAny | undefined {
  const accepting = options.find((o) => o.safeParse(value).success);
  if (accepting) return accepting;
  // A definition read out of the sealed box has "__potyro_fn__" where its functions were, so the
  // object around one may parse nowhere; it still has words to find.
  // An object shape first: `z.custom` (a function's schema) is a refinement too, and would be a dead end
  // for an action whose `run` names a function rather than writing one (`run: removeWord`).
  if (isPlainObject(value)) {
    const kind = (o: z.ZodTypeAny): string => (o._def as AnyDef).typeName ?? "";
    return options.find((o) => ["ZodObject", "ZodDiscriminatedUnion", "ZodLazy"].includes(kind(o))) ?? options.find((o) => kind(o) === "ZodEffects");
  }
  return undefined;
}

/** Copy-on-write: `obj` itself when nothing changed, so untouched parts keep their identity. */
function walk(schema: z.ZodTypeAny, value: unknown, path: (string | number)[], visit: WordsVisitor): unknown {
  if (isWordsSchema(schema)) {
    if (typeof value !== "string" && !isWordsMap(value) && !isContextWords(value)) return value;
    const next = visit(value as Words, path);
    return next === undefined ? value : next;
  }
  if (value === undefined || value === null) return value;
  const def = schema._def as AnyDef;
  switch (def.typeName) {
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodReadonly":
    case "ZodBranded":
      return walk(def.innerType as z.ZodTypeAny, value, path, visit);
    case "ZodLazy":
      return walk((def.getter as () => z.ZodTypeAny)(), value, path, visit);
    case "ZodEffects":
      return walk(def.schema as z.ZodTypeAny, value, path, visit);
    case "ZodObject": {
      if (!isPlainObject(value)) return value;
      const shape = (schema as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
      let out: Record<string, unknown> | null = null;
      for (const key of Object.keys(shape)) {
        if (!(key in value)) continue;
        const next = walk(shape[key]!, value[key], [...path, key], visit);
        if (next !== value[key]) (out ??= { ...value })[key] = next;
      }
      return out ?? value;
    }
    case "ZodArray": {
      if (!Array.isArray(value)) return value;
      const item = def.type as z.ZodTypeAny;
      let out: unknown[] | null = null;
      value.forEach((v, i) => {
        const next = walk(item, v, [...path, i], visit);
        if (next !== v) (out ??= [...value])[i] = next;
      });
      return out ?? value;
    }
    case "ZodRecord": {
      if (!isPlainObject(value)) return value;
      const item = def.valueType as z.ZodTypeAny;
      let out: Record<string, unknown> | null = null;
      for (const [key, v] of Object.entries(value)) {
        const next = walk(item, v, [...path, key], visit);
        if (next !== v) (out ??= { ...value })[key] = next;
      }
      return out ?? value;
    }
    case "ZodDiscriminatedUnion": {
      if (!isPlainObject(value)) return value;
      const member = (schema as z.ZodDiscriminatedUnion<string, z.AnyZodObject[]>).optionsMap.get(value[def.discriminator as string] as string);
      return member ? walk(member, value, path, visit) : value;
    }
    case "ZodUnion": {
      const member = unionMember(def.options as z.ZodTypeAny[], value);
      return member ? walk(member, value, path, visit) : value;
    }
    case "ZodIntersection":
      return walk(def.right as z.ZodTypeAny, walk(def.left as z.ZodTypeAny, value, path, visit), path, visit);
    default:
      return value;
  }
}

/**
 * Visit every words slot of an app definition — a live one (functions in place) or one read out of
 * the sealed box (functions as sentinels). Returns the definition with the visitor's replacements,
 * or the same object when it replaced nothing.
 */
export function walkWords<T>(definition: T, visit: WordsVisitor): T {
  return walk(structureSchema, definition, [], visit) as T;
}

/** Every words slot, with its path and value, in the order the schema lists them. */
export function wordSlots(definition: unknown): Array<{ path: WordsPath; value: Words }> {
  const out: Array<{ path: WordsPath; value: Words }> = [];
  walkWords(definition, (value, path) => void out.push({ path: [...path], value }));
  return out;
}

/** A path as one line: `pages.0.title`, as Zod issues read. */
export const wordsPathText = (path: WordsPath): string => path.join(".");

// ── catalogs (docs/30) ──────────────────────────────────────────────────────────────────────────
//
// An app is written in one language; its translations are catalogs beside it, one per language,
// compiled from `locales/<lang>.po` into `{ msgid → msgstr }` with the source text as the msgid. The
// host attaches them to the loaded definition, so `localize()`, `word()` and `ctx.t` find them without
// app code ever seeing them.

/** One language's translations: source text → translated text. A `msgctxt` is `context\u0004text`. */
export type Catalog = Readonly<Record<string, string>>;

const catalogsByApp = new WeakMap<object, Readonly<Record<Language, Catalog>>>();

/** Give a loaded definition its catalogs, replacing any it had. What it was shown in is forgotten. */
export function attachCatalogs(definition: object, catalogs: Readonly<Record<Language, Catalog>> | undefined): void {
  if (catalogs && Object.keys(catalogs).length) catalogsByApp.set(definition, catalogs);
  else catalogsByApp.delete(definition);
  localized.delete(definition);
}

/** The catalogs attached to a definition, by language. */
export function catalogsOf(definition: object | undefined): Readonly<Record<Language, Catalog>> {
  return (definition && catalogsByApp.get(definition)) || {};
}

/** The catalog for `language`, when the definition carries one. */
export function catalogFor(definition: object | undefined, language: Language | undefined): Catalog | undefined {
  return language ? catalogsOf(definition)[language] : undefined;
}

/**
 * Mark words for translation where they are written, to be translated where they are shown (docs/30):
 * `const MODES = { twin: msg("Twin") }` … `ctx.t(MODES[mode])`. It returns its argument unchanged; it
 * only tells the extractor these are words (gettext's `N_`, Lingui's `msg`). A table of words behind a
 * const is otherwise invisible to it.
 */
export function msg<T extends string | ContextWords>(words: T): T {
  return words;
}

/** Source text in a catalog: its translation, else the source text itself (missing or empty msgstr). */
export function lookup(text: string, catalog: Catalog | undefined, context?: string): string {
  if (!catalog) return text;
  const hit = catalog[context ? `${context}\u0004${text}` : text];
  return typeof hit === "string" && hit !== "" ? hit : text;
}

/**
 * The languages an app carries: `languages`, else `[language]`, else none (an old app); and every
 * language it has a catalog for.
 */
export function appLanguages(app: Pick<AppDefinition, "language" | "languages">): Language[] {
  const declared = app.languages?.length ? [...app.languages] : app.language ? [app.language] : [];
  for (const l of Object.keys(catalogsOf(app))) if (!declared.includes(l)) declared.push(l);
  return declared;
}

const baseOf = (tag: string): string => tag.split("-")[0]!.toLowerCase();

/**
 * The language to show an app in, for a person whose languages are `prefs` in order (their explicit
 * choice alone, or the device's list): for each preference, the exact tag the app carries, else one
 * with the same base language ("pl-PL" → "pl", "pt-PT" → "pt-BR"); else the app's own language.
 * `undefined` for an app that declares no language — its strings are shown as written.
 */
export function pickLanguage(prefs: readonly string[], app: Pick<AppDefinition, "language" | "languages">): Language | undefined {
  if (!app.language) return undefined;
  const available = appLanguages(app);
  for (const pref of prefs) {
    if (!pref) continue;
    const exact = available.find((l) => l.toLowerCase() === pref.toLowerCase());
    if (exact) return exact;
    const base = available.find((l) => baseOf(l) === baseOf(pref));
    if (base) return base;
  }
  return app.language;
}

/**
 * One slot's words in `language`: a plain string as it is; a map's entry for `language`, else the
 * app's own language, else the first of its languages the map has, else whatever it has. The last
 * two exist only for data that should not exist (a copy from a newer Potyro, a hand edit) — they
 * keep it readable rather than blank.
 */
export function word(w: Words | undefined | null, language: Language | undefined, app?: Pick<AppDefinition, "language" | "languages">, catalog?: Catalog): string {
  if (w == null) return "";
  if (typeof w === "string") return lookup(w, catalog ?? catalogFor(app, language));
  if (isContextWords(w)) return lookup(w.text, catalog ?? catalogFor(app, language), w.context);
  if (!isWordsMap(w)) return String(w);
  if (language && typeof w[language] === "string") return w[language]!;
  if (app?.language && typeof w[app.language] === "string") return w[app.language]!;
  for (const l of app?.languages ?? []) if (typeof w[l] === "string") return w[l]!;
  const first = Object.values(w).find((v) => typeof v === "string");
  return first ?? "";
}

/**
 * The definition with every words slot replaced by its string in `language` (`pickLanguage`'s
 * answer). Functions, records and everything else are untouched, and so is a definition with no
 * maps in it — it comes back as the same object. Views read the result, so they only ever see
 * strings.
 */
export function localize<T extends Pick<AppDefinition, "language" | "languages">>(definition: T, language: Language | undefined): Localized<T> {
  // A definition is never changed in place (a new version is a new object), so one walk per
  // definition and language is enough — the host asks for it on every pass.
  let byLanguage = localized.get(definition);
  if (!byLanguage) localized.set(definition, (byLanguage = new Map()));
  const key = language ?? "";
  let out = byLanguage.get(key);
  if (out === undefined) {
    const catalog = catalogFor(definition, language);
    out = walkWords(definition, (value) => (typeof value === "string" ? (catalog ? lookup(value, catalog) : undefined) : word(value, language, definition)));
    byLanguage.set(key, out);
  }
  return out as Localized<T>;
}

const localized = new WeakMap<object, Map<string, unknown>>();

const FIELDS = z.record(fieldSchema);

/** The same for a set of fields on their own — a `ctx.ui.form`'s — in the app's terms. */
export function localizeFields(fields: Record<string, Field>, language: Language | undefined, app: Pick<AppDefinition, "language" | "languages">): Record<string, Localized<Field>> {
  const catalog = catalogFor(app, language);
  return walk(FIELDS, fields, [], (value) => (typeof value === "string" ? (catalog ? lookup(value, catalog) : undefined) : word(value, language, app))) as Record<string, Localized<Field>>;
}

/** Option keys of each enum/tags field that declares `labels`, with where it sits. */
function labelledFields(def: AppDefinition): Array<{ where: string; options?: readonly string[]; labels: Record<string, unknown> }> {
  const out: Array<{ where: string; options?: readonly string[]; labels: Record<string, unknown> }> = [];
  const visit = (fields: unknown, where: string): void => {
    if (!isPlainObject(fields)) return;
    for (const [key, f] of Object.entries(fields)) {
      if (!isPlainObject(f)) continue;
      if ((f.type === "enum" || f.type === "tags") && isPlainObject(f.labels)) out.push({ where: `${where}.${key}`, options: f.options as string[] | undefined, labels: f.labels });
      if (f.type === "list") visit(f.of, `${where}.${key}.of`);
    }
  };
  for (const [name, entity] of Object.entries(def.entities ?? {})) {
    visit(entity.fields, `entities.${name}.fields`);
    for (const [key, action] of Object.entries(entity.actions ?? {})) if (isPlainObject(action)) visit(action.input, `entities.${name}.actions.${key}.input`);
  }
  return out;
}

/**
 * The app-level rules for words (docs/20 §1.4 phase 2), beside `checkReferences`: an app with a map
 * declares `language`; `languages` contains it; every map has it; no map carries a language the app
 * does not; every `labels` key is an option. A map missing one of the app's OTHER languages is not
 * an error — that is an unfinished translation, and it falls back for that one string.
 */
export function checkWords(def: AppDefinition): string[] {
  const issues: string[] = [];
  const maps = wordSlots(def).filter((s) => isWordsMap(s.value));
  const languages = appLanguages(def);
  if (def.languages?.length && !def.language) issues.push("`languages` is declared, so the app needs `language:` saying which one is its own");
  if (def.language && def.languages?.length && !def.languages.includes(def.language)) {
    issues.push(`languages must include the app's own language "${def.language}"`);
  }
  if (maps.length && !def.language) {
    issues.push(`${wordsPathText(maps[0]!.path)} is a translation map, so the app needs \`language:\` saying which one is its own`);
  }
  if (def.language) {
    for (const { path, value } of maps) {
      const map = value as Record<string, string>;
      if (!(def.language in map)) issues.push(`${wordsPathText(path)} has no "${def.language}" — every translation map needs the app's own language`);
      for (const key of Object.keys(map)) {
        if (!languages.includes(key)) issues.push(`${wordsPathText(path)} has "${key}", which is not one of the app's languages (${languages.join(", ")}) — add it to \`languages\` or fix the tag`);
      }
    }
  }
  for (const { where, options, labels } of labelledFields(def)) {
    if (!options) continue;
    for (const key of Object.keys(labels)) {
      if (!options.includes(key)) issues.push(`${where}.labels names "${key}", which is not an option (${options.join(", ")})`);
    }
  }
  return issues;
}

/** One gap in a translation: a map without one of the app's languages. */
export interface WordsGap {
  path: string;
  missing: Language[];
}

/** Every declarative map that lacks one of the app's languages (the generator's completeness check). */
export function wordGaps(def: Pick<AppDefinition, "language" | "languages">): WordsGap[] {
  const languages = appLanguages(def);
  if (languages.length < 2) return [];
  const gaps: WordsGap[] = [];
  for (const { path, value } of wordSlots(def)) {
    if (!isWordsMap(value)) continue;
    const missing = languages.filter((l) => !(l in value));
    if (missing.length) gaps.push({ path: wordsPathText(path), missing });
  }
  return gaps;
}
