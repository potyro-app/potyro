// An app's own words as the shell shows them around it (#302, docs/20 §3.2–3.3): its name on a tile,
// in the switcher and the Studio, and the quiet line that says which language it is in.

import { t } from "@lingui/core/macro";
import { i18n } from "@potyro/i18n";
import { appLanguages, pickLanguage, word, type AppDefinition, type Language, type Words } from "potyro";

type Named = { name: Words; language?: Language; languages?: Language[] };

/**
 * The name in the app's OWN language — what a saved app's `name` holds, and what Rename edits. A
 * one-language app's name as it is.
 */
export function ownName(def: Named): string {
  return word(def.name, def.language, def);
}

/**
 * What to call an app for this person. A name they gave it (a Rename) wins as it is; one that is
 * still the name the source declares follows the source, in their language.
 */
export function shownName(saved: string | undefined, def: Named, prefs: readonly string[]): string {
  const given = saved?.trim();
  if (given && given !== ownName(def)) return given;
  return word(def.name, pickLanguage(prefs, def), def);
}

const baseOf = (tag: string): string => tag.split("-")[0]!.toLowerCase();

/** A language's name, as people who speak `inLanguage` write it: "English", "Polski". */
export function languageName(tag: Language, inLanguage: Language = tag): string {
  try {
    const name = new Intl.DisplayNames([inLanguage], { type: "language" }).of(tag) ?? tag;
    return name.charAt(0).toLocaleUpperCase(inLanguage) + name.slice(1);
  } catch {
    return tag;
  }
}

export interface LanguageNote {
  /** "This app is in English." — in the shell's language. */
  line: string;
  /** The language to offer a translation into, named in itself ("Polski"), when it is not there. */
  into: { tag: Language; name: string };
  /** "Translate into Polski" — in the shell's language. */
  offer: string;
}

/**
 * The line an app's menu says when it lacks the person's language (docs/20 §3.3), or `null` when it
 * has it, or declares no language at all. No banner: the app opens in its own language as it is.
 */
export function languageNote(def: Pick<AppDefinition, "language" | "languages">, prefs: readonly string[], shellLanguage: Language = i18n.locale): LanguageNote | null {
  if (!def.language) return null;
  const wanted = prefs[0];
  if (!wanted) return null;
  const carried = appLanguages(def);
  if (carried.some((l) => baseOf(l) === baseOf(wanted))) return null;
  const language = languageName(def.language, shellLanguage);
  const into = languageName(baseOf(wanted));
  return {
    line: t`This app is in ${language}.`,
    into: { tag: baseOf(wanted), name: into },
    offer: t`Translate into ${into}`,
  };
}

/** Right-to-left scripts (docs/20 Q11): the app root takes `dir="rtl"` for them, a first step only. */
const RTL = new Set(["ar", "he", "fa", "ur", "ps", "yi", "dv", "ckb", "sd", "ug"]);
export const isRtl = (language: Language | undefined): boolean => Boolean(language && RTL.has(baseOf(language)));
