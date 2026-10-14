// Words an app shows to a person, in one language or several (#302, docs/20).

/** A BCP 47 language tag: "en", "pl", "pt-BR", "de-CH". */
export type Language = string;

/**
 * Words a person reads: a string, the same in every language, or one per language — `{ en: "Nights",
 * pl: "Noce" }`, the app's own first, on one line when it fits. Records are never translated.
 */
export type Words = string | WordsMap;

/** The per-language form of `Words`. */
export type WordsMap = { readonly [language: Language]: string };

