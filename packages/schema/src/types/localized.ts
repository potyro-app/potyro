// The definition as views read it (#302). Kept out of the model's reference (generator/src/
// reference.ts lists the files it reads): app code never writes this type, the runtime hands it over.

import type { Words, WordsMap } from "./words.js";

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
