// Which language to show — pure functions, no Lingui, no DOM, no storage.
//
// Kept apart from everything else in the package on purpose: matching a person's languages against
// a set of available ones is the same question for Potyro's own catalogs (here) and, later, for an
// app that carries its own translations (#302: the person's language, then the app's default, then
// the first one it has). So `matchLocale` takes the available set as an argument rather than
// assuming Potyro's six, and `@potyro/i18n/locale` can be imported by the host or runtime without
// pulling in React or a catalog.

/** The language every message is written in, and the one anything missing falls back to. */
export const SOURCE_LOCALE = "en";

/** Potyro's own languages (#297, owner decision 2026-10-13). */
export const LOCALES = ["en", "pt-BR", "de", "es", "pl", "it"] as const;
export type AppLocale = (typeof LOCALES)[number];

/**
 * The pseudo-language: every letter accented and every message padded and bracketed, so text that
 * did not go through a catalog is the one thing on screen still in plain ASCII. Dev and tests only.
 * `en-XA` is the tag Android and Chrome use for the same thing, so `Intl` treats it as English.
 */
export const PSEUDO_LOCALE = "en-XA";

/** A language as the picker offers it. */
export interface LocaleInfo {
  tag: string;
  /** Its own name for itself — a person looking for their language reads it in that language. */
  autonym: string;
  /**
   * Shipped as a model's draft, not reviewed (owner decision, #297): the picker says so. Every
   * language but the source one, until someone has checked it.
   */
  draft: boolean;
}

export const LOCALE_INFO: Readonly<Record<AppLocale, LocaleInfo>> = {
  en: { tag: "en", autonym: "English", draft: false },
  "pt-BR": { tag: "pt-BR", autonym: "Português (Brasil)", draft: true },
  de: { tag: "de", autonym: "Deutsch", draft: true },
  es: { tag: "es", autonym: "Español", draft: true },
  pl: { tag: "pl", autonym: "Polski", draft: true },
  it: { tag: "it", autonym: "Italiano", draft: true },
};

/**
 * A language tag in the one spelling the rest of this file compares: `pt_br` and `PT-br` are
 * `pt-BR`, Android's `und` and a browser's `*` are nothing. Returns null for anything that is not a
 * language at all.
 */
export function normalizeTag(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parts = raw.trim().replace(/_/g, "-").split("-").filter(Boolean);
  const lang = parts[0]?.toLowerCase();
  if (!lang || lang === "*" || lang === "und" || !/^[a-z]{2,3}$/.test(lang)) return null;
  const rest = parts.slice(1).map((p) => (p.length === 2 ? p.toUpperCase() : p.length === 4 ? p[0]!.toUpperCase() + p.slice(1).toLowerCase() : p.toLowerCase()));
  return [lang, ...rest].join("-");
}

const languageOf = (tag: string): string => tag.split("-")[0]!.toLowerCase();

/**
 * The best of `available` for someone whose languages are `requested`, most preferred first.
 *
 * For each requested language in turn: the same tag exactly, else the same language in another
 * region or script (`pt-PT` → `pt-BR`, `de-AT` → `de`, `pl` → `pl-PL`). Only when none of the
 * person's languages is available at all does `fallback` answer — a Portuguese speaker in Lisbon
 * is better served by Brazilian Portuguese than by their second choice of English, so a language
 * match on the first preference beats an exact match on the second.
 *
 * Among several regions of one language the first listed in `available` wins, so the order of
 * `available` is the tie-break (an app's default language goes first, #302).
 */
export function matchLocale(requested: readonly (string | null | undefined)[], available: readonly string[], fallback: string): string {
  const offered = available.map((a) => ({ tag: a, norm: normalizeTag(a) })).filter((a): a is { tag: string; norm: string } => a.norm !== null);
  for (const raw of requested) {
    const want = normalizeTag(raw);
    if (!want) continue;
    const exact = offered.find((a) => a.norm.toLowerCase() === want.toLowerCase());
    if (exact) return exact.tag;
    const lang = languageOf(want);
    const same = offered.find((a) => languageOf(a.norm) === lang);
    if (same) return same.tag;
  }
  return fallback;
}

/** What the device says it reads, best first: the native system locale (Android), then the browser's. */
export interface DeviceLanguages {
  /** `navigator.languages`, or `[navigator.language]` where that is all there is. */
  browser: readonly string[];
  /** The OS's own locale where a native shell can tell us (Capacitor `Device.getLanguageTag`). */
  system?: readonly string[] | null;
}

/** Potyro's language for this device, from what it reads — never null; English when nothing matches. */
export function deviceLocale(device: DeviceLanguages, available: readonly string[] = LOCALES): string {
  return matchLocale([...(device.system ?? []), ...device.browser], available, SOURCE_LOCALE);
}

/**
 * The saved choice, if it is one this build can show. `"auto"` (or nothing) means "follow the
 * device", which is also what an unknown or since-removed tag falls back to.
 */
export function resolveLocale(saved: string | null | undefined, device: DeviceLanguages, opts: { pseudo?: boolean } = {}): string {
  if (saved === PSEUDO_LOCALE && opts.pseudo) return PSEUDO_LOCALE;
  if (saved && saved !== "auto" && (LOCALES as readonly string[]).includes(saved)) return saved;
  return deviceLocale(device);
}

/** The language `Intl` should format for: the pseudo-language formats as English. */
export function intlLocale(locale: string): string {
  return locale === PSEUDO_LOCALE ? SOURCE_LOCALE : locale;
}
