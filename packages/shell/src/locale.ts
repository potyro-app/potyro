// The person's language, as the shell knows it — a minimal stand-in (#302).
//
// #298 owns the real thing (the shell's catalogs, You → Language, detection), and #301 adds a
// `currentLocale()` for model turns in this same file. Until those land, this is the one place that
// answers "which languages does this person read?" for APPS: their explicit choice alone, else the
// device's whole list, in order (docs/20 §3.1, Q10). #298 should keep `LOCALE_KEY` (or move it
// here) and re-export its getter beside `languagePrefs`; every app caller goes through these two.

/** Where a chosen language is saved on this device — the same key #301 reads. */
export const LOCALE_KEY = "potyro:locale";

/** Said when the saved choice changes in this tab (a `storage` event covers the other tabs). */
export const LOCALE_CHANGED = "potyro:locale:changed";

/** The explicit choice under You → Language, or `null` to follow the device. */
export function chosenLanguage(): string | null {
  try {
    const saved = globalThis.localStorage?.getItem(LOCALE_KEY);
    return saved && saved.trim() ? saved.trim() : null;
  } catch {
    return null; // storage blocked: follow the device
  }
}

/**
 * The languages this person reads, best first: an explicit choice wins outright (someone who chose
 * English on a German phone gets English apps), otherwise the device's list — so a French phone
 * still shows a French app in French, though the shell has no French yet.
 */
export function languagePrefs(): string[] {
  const chosen = chosenLanguage();
  if (chosen) return [chosen];
  const nav = globalThis.navigator;
  const list = nav?.languages?.length ? [...nav.languages] : nav?.language ? [nav.language] : [];
  return list.length ? list : ["en"];
}

/** Hear the person's languages change: a new choice here or in another tab, or the device's. */
export function onLanguagePrefsChange(cb: () => void): () => void {
  const target = globalThis as unknown as EventTarget;
  if (typeof target.addEventListener !== "function") return () => {};
  const onStorage = (e: Event): void => {
    const key = (e as StorageEvent).key;
    if (key === null || key === LOCALE_KEY) cb();
  };
  target.addEventListener("languagechange", cb);
  target.addEventListener(LOCALE_CHANGED, cb);
  target.addEventListener("storage", onStorage);
  return () => {
    target.removeEventListener("languagechange", cb);
    target.removeEventListener(LOCALE_CHANGED, cb);
    target.removeEventListener("storage", onStorage);
  };
}
