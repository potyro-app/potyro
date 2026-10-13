// The person's language, for the model turns (#301) — a minimal stand-in.
//
// #298 owns the real thing: the Lingui catalogs, You → Language and locale detection. Until it lands
// this is the one place a model turn asks "which language?": the choice saved on this device, else the
// best match for the browser's languages, else English. #298 should replace this file's body (or
// re-export its own getter under this name); every caller goes through `currentLocale()`, so nothing
// else needs to change.

import { bestLanguage, isLanguage, type Language } from "@potyro/generator/language";

/** Where a chosen language is saved on this device. #298 may move it; then only this line changes. */
export const LOCALE_KEY = "potyro:locale";

/** The language the model answers in and writes new apps in: the saved choice, else the device's. */
export function currentLocale(): Language {
  try {
    const saved = globalThis.localStorage?.getItem(LOCALE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    // storage blocked: fall through to the device's languages
  }
  const nav = globalThis.navigator;
  return bestLanguage(nav?.languages?.length ? nav.languages : [nav?.language]);
}
