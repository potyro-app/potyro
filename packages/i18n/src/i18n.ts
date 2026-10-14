/// <reference path="./po.d.ts" />
// The one Lingui instance, which language it shows, and how it gets there.
//
// ## Catalogs
// English is imported statically: it is in the main chunk, so the first paint never waits on a
// fetch, and it is what every other language falls back to message by message. Every other language
// is a dynamic import — its own small chunk, fetched when chosen and precached by the service worker
// so choosing one offline works (packages/shell/vite.config.ts writes the list the worker reads).
//
// ## Fallback, per message
// A message that has not been translated yet (a new string, or a whole empty catalog, as Polish is
// on day one) reads in English, not as its hash id — in a production build the macros keep only the
// id, so a gap would otherwise put `x7Kq2a` on screen. Two layers make sure: the compiler fills an
// empty msgstr with the English source, and the runtime lays every catalog over English anyway
// (`withFallback`), which also covers a catalog that is simply missing an id.
//
// ## The choice
// Saved per device under `potyro:locale`: a language tag, or nothing / "auto" for "follow the
// device". Switching is live — `setLocale` loads the chunk and activates it, and every component
// reading `useLingui` re-renders. No reload.

import { i18n, type Messages } from "@lingui/core";
import { messages as en } from "../locales/en/messages.po";
import { LOCALES, PSEUDO_LOCALE, SOURCE_LOCALE, resolveLocale, type DeviceLanguages } from "./locale.js";

export { i18n };

const loaders: Record<string, () => Promise<{ messages: Messages }>> = {
  "pt-BR": () => import("../locales/pt-BR/messages.po"),
  de: () => import("../locales/de/messages.po"),
  es: () => import("../locales/es/messages.po"),
  pl: () => import("../locales/pl/messages.po"),
  it: () => import("../locales/it/messages.po"),
  [PSEUDO_LOCALE]: async () => {
    const { pseudoMessages } = await import("./pseudo.js");
    return { messages: pseudoMessages(en) };
  },
};

/** `translated` laid over English: what it has wins, English fills every gap. */
export function withFallback(translated: Messages, source: Messages = en): Messages {
  const out: Messages = { ...source };
  for (const [id, m] of Object.entries(translated)) {
    // An untranslated entry can arrive as "" or [] from a catalog; that is a gap, not a translation.
    if (m === "" || (Array.isArray(m) && m.length === 0) || m === undefined) continue;
    out[id] = m;
  }
  return out;
}

export const LOCALE_KEY = "potyro:locale";

let pseudoAvailable = false;
/** Offer the pseudo-language (the shell turns this on in dev builds only). */
export function setPseudoAvailable(on: boolean): void {
  pseudoAvailable = on;
}
export function isPseudoAvailable(): boolean {
  return pseudoAvailable;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // a sandboxed frame or blocked site data: the choice simply is not remembered
  }
}

/** The saved choice: a tag, or "auto" for "follow the device". */
export function savedLocale(): string {
  try {
    return storage()?.getItem(LOCALE_KEY) || "auto";
  } catch {
    return "auto";
  }
}

let systemLanguages: readonly string[] | null = null;
/**
 * The native OS locale, where a native shell can say (Android, via Capacitor). Set by the shell
 * once it has asked; re-resolves "auto" in case the system answer differs from the WebView's.
 */
export async function setSystemLanguages(tags: readonly string[] | null): Promise<void> {
  systemLanguages = tags && tags.length ? tags : null;
  if (savedLocale() === "auto") await activate(currentDeviceLocale());
}

function browserLanguages(): readonly string[] {
  const nav = globalThis.navigator as Navigator | undefined;
  if (!nav) return [];
  return nav.languages?.length ? nav.languages : nav.language ? [nav.language] : [];
}

export function deviceLanguages(): DeviceLanguages {
  return { browser: browserLanguages(), system: systemLanguages };
}

/** What "follow the device" resolves to right now. */
export function currentDeviceLocale(): string {
  return resolveLocale("auto", deviceLanguages());
}

const loaded = new Set<string>([SOURCE_LOCALE]);
i18n.load(SOURCE_LOCALE, en);
// Active from the moment this module is imported, so nothing ever renders before a locale exists
// (Lingui throws on a translation call with no active locale).
i18n.activate(SOURCE_LOCALE);

let pending = 0;
async function activate(locale: string): Promise<void> {
  const ticket = ++pending;
  if (!loaded.has(locale)) {
    const load = loaders[locale];
    if (!load) return;
    const { messages } = await load();
    i18n.load(locale, withFallback(messages));
    loaded.add(locale);
  }
  // Two quick choices in a row: the later one wins even if its chunk arrived first.
  if (ticket !== pending) return;
  if (i18n.locale !== locale) i18n.activate(locale);
  const root = globalThis.document?.documentElement;
  if (root) root.lang = locale === PSEUDO_LOCALE ? SOURCE_LOCALE : locale;
}

/** The language to start in, from the saved choice and the device. */
export function initialLocale(): string {
  return resolveLocale(savedLocale(), deviceLanguages(), { pseudo: pseudoAvailable });
}

/** Load and show the starting language. Awaited by boot before the first paint. */
export async function startI18n(opts: { pseudo?: boolean } = {}): Promise<string> {
  if (opts.pseudo !== undefined) setPseudoAvailable(opts.pseudo);
  const locale = initialLocale();
  try {
    await activate(locale);
  } catch (e) {
    // A chunk that will not load (offline before the worker cached it) must not stop the app.
    console.warn(`[potyro] could not load the ${locale} catalog; showing English:`, e);
  }
  return i18n.locale;
}

/**
 * Choose a language for this device: a tag, or "auto" to follow the device again. Live.
 */
export async function setLocale(choice: string): Promise<void> {
  const known = choice === "auto" || (LOCALES as readonly string[]).includes(choice) || (choice === PSEUDO_LOCALE && pseudoAvailable);
  if (!known) throw new Error(`Unknown language: ${choice}`);
  try {
    if (choice === "auto") storage()?.removeItem(LOCALE_KEY);
    else storage()?.setItem(LOCALE_KEY, choice);
  } catch {
    // not remembered, still switched
  }
  await activate(choice === "auto" ? currentDeviceLocale() : choice);
}

/** Forget everything loaded and go back to English — tests only. */
export function resetI18nForTests(): void {
  pending++;
  systemLanguages = null;
  pseudoAvailable = false;
  i18n.activate(SOURCE_LOCALE);
}
