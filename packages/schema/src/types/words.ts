// Words an app shows to a person, in one language or several (#302, docs/20).

/** A BCP 47 language tag: "en", "pl", "pt-BR", "de-CH". */
export type Language = string;

/**
 * Words shown to a person: one string, the same in every language, or the string per language.
 * Every map has the app's own `language` in it. Records are never translated — only the app's words.
 *
 *   label: "Nights"
 *   label: { en: "Nights", pl: "Noce", de: "Nächte" }
 *
 * Put a map on one line when it fits, otherwise one language per line, the app's own language first.
 */
export type Words = string | WordsMap;

/** The per-language form of `Words`. */
export type WordsMap = { readonly [language: Language]: string };

/** One slot of `Localized`: a slot that takes `Words` takes only its string; anything else recurses. */
type LocalizedSlot<V> = Words extends NonNullable<V> ? Exclude<V, WordsMap> : Localized<V>;

/**
 * A definition as views read it (`Runtime.definition`): every `Words` slot already resolved to its
 * string in the person's language, by `localize()`. Functions are left as they are.
 */
export type Localized<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { [K in keyof T]: LocalizedSlot<T[K]> } // arrays and tuples stay arrays and tuples
    : T;
