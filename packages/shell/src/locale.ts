// The person's language, for the shell's callers — thin, over @potyro/i18n (#298), which owns the
// saved choice (You → Language), the device's languages and the live switch.
//
// Two readings of one preference:
//   - `currentLocale()` (#301): the ONE language a model turn answers in and writes new apps in —
//     one the generator speaks.
//   - `languagePrefs()` (#302): the languages an APP is shown in, best first. An explicit choice wins
//     outright; otherwise the device's whole list, so a French phone still reads a French app in
//     French though the shell has no French (docs/20 §3.1, Q10).

import { LOCALE_KEY, deviceLanguages, i18n, initialLocale, savedLocale } from "@potyro/i18n";
import { bestLanguage, isLanguage, type Language } from "@potyro/generator/language";

export { LOCALE_KEY };

/** The language the model answers in and writes new apps in: the shell's, else the device's best match. */
export function currentLocale(): Language {
  const shell = initialLocale();
  if (isLanguage(shell)) return shell;
  const { browser, system } = deviceLanguages();
  return bestLanguage(system?.length ? system : browser);
}

/** The explicit choice under You → Language, or `null` to follow the device. */
export function chosenLanguage(): string | null {
  const saved = savedLocale();
  return saved && saved !== "auto" ? saved : null;
}

/** The languages this person reads apps in, best first: their choice alone, else the device's list. */
export function languagePrefs(): string[] {
  const chosen = chosenLanguage();
  if (chosen) return [chosen];
  const { browser, system } = deviceLanguages();
  const list = system?.length ? [...system] : [...browser];
  return list.length ? list : ["en"];
}

/** Hear the person's languages change: You → Language (here or in another tab), or the device's. */
export function onLanguagePrefsChange(cb: () => void): () => void {
  const offI18n = i18n.on("change", cb);
  const target = globalThis as unknown as EventTarget;
  if (typeof target.addEventListener !== "function") return offI18n;
  const onStorage = (e: Event): void => {
    const key = (e as StorageEvent).key;
    if (key === null || key === LOCALE_KEY) cb();
  };
  target.addEventListener("languagechange", cb);
  target.addEventListener("storage", onStorage);
  return () => {
    offI18n();
    target.removeEventListener("languagechange", cb);
    target.removeEventListener("storage", onStorage);
  };
}
