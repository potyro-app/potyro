// The page's first screen, in the HTML itself (#48).
//
// Until the script has been downloaded, read and run, `<div id="root">` was empty: about five
// seconds of nothing on a phone's first visit. This puts Home's own top in the page: the wordmark
// and, on a first visit, the heading and the line under it. The stylesheet draws it with the
// same classes the launcher uses (launcher.tsx), so when React renders Home over it the same
// things are in the same places, in light and in dark.
//
// Built by this plugin, not written into index.html, for two reasons. The words are Potyro's own,
// so they come from the catalogs (packages/i18n/locales): a heading written a second time in the
// HTML would drift from them, and a visitor reading German would see English first. And the
// wordmark is the designer's file (packages/design/logo), inlined as it is in the app's script.
//
// The few lines of script decide, before anything is drawn, what this visit will open on:
// - a chosen light or dark look goes on <html> now (look.ts does it again later);
// - a link that opens an app, a demo or a page, or the Start home screen: nothing here, as before;
// - someone who has opened an app before, or said "Not now": the wordmark only, as Home shows it;
// - the saved language, else the device's (the rule of i18n/src/locale.ts), picks the words.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/** Where index.html says the screen goes: inside #root, so React's first render replaces it. */
export const FIRST_SCREEN_SLOT = "<!--potyro:first-screen-->";

/** The words on it, by their text in the source (launcher.tsx). The catalogs' ids are the text. */
export const FIRST_SCREEN_WORDS = {
  heading: "Make the app you need",
  lede: "Say what you need and Potyro builds an app you can share. Or open one of the examples below and change it.",
} as const;

/** The languages with a catalog, the source first (i18n/src/locale.ts `LOCALES`). */
const LOCALES = ["en", "pt-BR", "de", "es", "pl", "it"] as const;

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

const unquote = (line: string): string => JSON.parse(line.slice(line.indexOf('"'))) as string;

/** `msgid` → `msgstr` for the entries of a .po file. Plain entries only: none of these has a plural. */
export function readCatalog(po: string): Map<string, string> {
  const found = new Map<string, string>();
  let id: string | null = null;
  let text: string | null = null;
  let into: "id" | "text" | null = null;
  const close = (): void => {
    if (id !== null && text !== null) found.set(id, text);
    id = text = into = null;
  };
  for (const line of po.split("\n")) {
    if (line.startsWith("msgid ")) {
      close();
      id = unquote(line);
      into = "id";
    } else if (line.startsWith("msgstr ")) {
      text = unquote(line);
      into = "text";
    } else if (line.startsWith('"') && into === "id") id += unquote(line);
    else if (line.startsWith('"') && into === "text") text += unquote(line);
    else if (!line.trim()) close();
  }
  close();
  return found;
}

type Words = Record<keyof typeof FIRST_SCREEN_WORDS, string>;

/** Each language's words, from its catalog. A word a catalog lacks is a build error, not English. */
export function firstScreenWords(read: (locale: string) => string = (locale) => readFileSync(here(`../i18n/locales/${locale}/messages.po`), "utf8")): Record<string, Words> {
  const all: Record<string, Words> = {};
  for (const locale of LOCALES) {
    const catalog = readCatalog(read(locale));
    const words = {} as Words;
    for (const [key, source] of Object.entries(FIRST_SCREEN_WORDS) as [keyof Words, string][]) {
      const text = locale === "en" ? source : catalog.get(source);
      if (!catalog.has(source) || !text) throw new Error(`first-screen: the ${locale} catalog has no words for “${source}” (launcher.tsx changed? update FIRST_SCREEN_WORDS)`);
      words[key] = text;
    }
    all[locale] = words;
  }
  return all;
}

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const logo = (name: string): string => `data:image/svg+xml;base64,${readFileSync(here(`../design/logo/${name}.svg`)).toString("base64")}`;

/**
 * What runs before the first paint. Written as a function so it is checked like any other code,
 * and put in the page as its own text: it can use nothing but its two arguments and the browser.
 */
function decide(words: Record<string, Words>, locales: readonly string[]): void {
  const root = document.documentElement;
  const screen = document.querySelector("[data-first-screen]");
  if (!screen) return;
  const get = (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  let look: { appearance?: unknown; launcher?: unknown } = {};
  try {
    look = (JSON.parse(get("potyro:look") ?? "{}") as typeof look) ?? {};
  } catch {
    look = {};
  }
  if (look.appearance === "light" || look.appearance === "dark") root.setAttribute("data-theme", look.appearance);
  // Not Home: an app, a page of the shell, a demo or share link, an invite. `#add=` and the device
  // check open over Home.
  const elsewhere =
    /[?&](user|app|data|share|move)(=|&|$)/.test(location.search) ||
    location.pathname.replace(/\/index\.html$/, "/") !== "/" ||
    (location.hash.length > 1 && !/^#(add|probe)=/.test(location.hash));
  if (elsewhere || look.launcher === "start") return screen.remove();
  root.setAttribute("data-first-screen", "");
  const firstVisit = get("potyro:welcome:dismissed") !== "1" && !/"openCount":[1-9]/.test(get("potyro:launcher") ?? "");
  if (!firstVisit) screen.querySelector("[data-first-welcome]")?.remove();
  const saved = get("potyro:locale");
  const wanted = saved && locales.includes(saved) ? [saved] : navigator.languages?.length ? navigator.languages : [navigator.language];
  let locale = locales[0]!;
  for (const tag of wanted) {
    const want = String(tag ?? "").replace(/_/g, "-").toLowerCase();
    const match = locales.find((l) => l.toLowerCase() === want) ?? locales.find((l) => l.split("-")[0]!.toLowerCase() === want.split("-")[0]);
    if (match) {
      locale = match;
      break;
    }
  }
  if (locale === locales[0]) return;
  root.lang = locale;
  const own = words[locale]!;
  for (const node of screen.querySelectorAll<HTMLElement>("[data-first-word]")) {
    const key = node.dataset.firstWord as keyof Words;
    node.textContent = own[key];
  }
}

/** The screen's HTML: Home's header and welcome as launcher.tsx renders them, and the script. */
export function firstScreenHtml(words: Record<string, Words> = firstScreenWords()): string {
  const en = words.en!;
  const others = Object.fromEntries(Object.entries(words).filter(([locale]) => locale !== "en"));
  // `<` never appears raw inside the script: a catalog's text cannot close the tag.
  const data = JSON.stringify(others).replace(/</g, "\\u003c");
  return [
    // `k-first`, not the launcher's own classes: the stylesheet gives it the same box (styles.css), and
    // nothing that waits for Home (a test, the Android splash) can take this for it.
    `<div class="k-first" data-first-screen aria-hidden="true">`,
    `<header class="k-launcher-head">`,
    `<div class="k-brand">`,
    `<span class="k-wordmark"><img class="k-wordmark-light" src="${logo("wordmark-rosa")}" alt="" /><img class="k-wordmark-dark" src="${logo("wordmark-rosa-on-dark")}" alt="" /></span>`,
    `</div>`,
    // Holds the row as tall as the header's buttons make it, so nothing moves when they arrive.
    `<div class="k-launcher-head-actions"><span class="k-launch-you" style="visibility:hidden"></span></div>`,
    `</header>`,
    `<section class="k-welcome" data-first-welcome><h2 data-first-word="heading">${escapeHtml(en.heading)}</h2><p data-first-word="lede">${escapeHtml(en.lede)}</p></section>`,
    `</div>`,
    `<script>(${decide.toString()})(${data},${JSON.stringify(LOCALES)})</script>`,
  ].join("");
}

/** Puts the screen where index.html asks for it, in the dev server and in a build alike. */
export function firstScreen(): Plugin {
  return {
    name: "potyro-first-screen",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (!html.includes(FIRST_SCREEN_SLOT)) throw new Error(`first-screen: index.html has lost ${FIRST_SCREEN_SLOT}`);
        return html.replace(FIRST_SCREEN_SLOT, firstScreenHtml());
      },
    },
  };
}
