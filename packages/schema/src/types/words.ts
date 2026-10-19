// Words an app shows to a person, in one language or several (#302, docs/20).

/** A BCP 47 language tag: "en", "pl", "pt-BR", "de-CH". */
export type Language = string;

/**
 * Words a person reads, in the app's own language; their translations are the app's catalogs,
 * `locales/<lang>.po` (docs/30). Where one text means two things ("Water" the verb and the noun),
 * `{ text, context }` tells them apart. A per-language map `{ en, pl }` is the older form (docs/20),
 * still read. Records are never translated.
 */
export type Words = string | ContextWords | WordsMap;

/** Words with a `context`: the same text, translated apart (gettext's `msgctxt`). */
export type ContextWords = { readonly text: string; readonly context: string };

/** The per-language form of `Words`. */
export type WordsMap = { readonly [language: Language]: string };

