// The Zod shape of `Words` (#302, docs/20 §1.4 phase 1). Every slot that shows words to a person
// uses one of these schemas, and nothing else does — so the walker in words.ts, which looks for
// exactly these schema objects inside `structureSchema`, finds every slot and only those. The list
// of slots therefore exists once: where the schema says so.

import { z } from "zod";
import type { Words } from "./types/words.js";

/** A well-formed BCP 47 tag of the kind an app declares: "en", "pl", "pt-BR", "zh-Hant", "es-419". */
export const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?$/;

export const zLanguage = z.string().regex(LANGUAGE_TAG, 'must be a language tag like "en", "pl" or "pt-BR"');

/** The schema objects that mean "words go here". The walker recognises a slot by membership. */
const WORDS_SCHEMAS = new WeakSet<z.ZodTypeAny>();

export function isWordsSchema(schema: z.ZodTypeAny): boolean {
  return WORDS_SCHEMAS.has(schema);
}

/** A translation map: an object (not an array, not null) — the one shape that is not a plain string. */
export function isWordsMap(value: unknown): value is { readonly [language: string]: string } {
  return value != null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Words: a string, or `{ [language]: string }`. Hand-written rather than `z.union` so a wrong value
 * says what words are ("text, or a map of languages to text") instead of Zod's bare "Invalid input",
 * and a bad key names itself. `minLength` 1 for the slots that refuse an empty label.
 */
function words(minLength: number): z.ZodType<Words> {
  const schema = z.any().superRefine((value: unknown, ctx) => {
    if (typeof value === "string") {
      if (value.length < minLength) ctx.addIssue({ code: z.ZodIssueCode.too_small, minimum: minLength, type: "string", inclusive: true, message: "must not be empty" });
      return;
    }
    if (!isWordsMap(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'expected text, or a map of languages to text like { en: "Item", pl: "Produkt" }' });
      return;
    }
    const entries = Object.entries(value);
    if (entries.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a translation map needs at least the app's own language" });
    for (const [key, text] of entries) {
      if (!LANGUAGE_TAG.test(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `"${key}" is not a language tag like "en", "pl" or "pt-BR"` });
      else if (typeof text !== "string" || text.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "must be non-empty text" });
    }
  }) as unknown as z.ZodType<Words>;
  WORDS_SCHEMAS.add(schema);
  return schema;
}

/** Words that may be empty (labels, help, placeholders — an empty one has always been allowed). */
export const zWords = words(0);
/** Words that must say something (a button, a summary, a quick action). */
export const zWordsNonEmpty = words(1);

/** Words as one string for a message about the app (an issue, a log line): a map's first entry. */
export function plainWords(w: Words | undefined): string {
  if (w == null) return "";
  if (typeof w === "string") return w;
  return isWordsMap(w) ? (Object.values(w).find((v) => typeof v === "string") ?? "") : String(w);
}
