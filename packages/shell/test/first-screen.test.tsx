// @vitest-environment happy-dom
// The page's first screen (#48, first-screen.ts): Home's top in the HTML itself, its words from the
// catalogs, and the few lines that decide what a visit shows before anything is drawn. And the mark
// that says the first REAL screen is up (first-ready.tsx): absent while only this one shows.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FIRST_SCREEN_SLOT, FIRST_SCREEN_WORDS, firstScreenHtml, firstScreenWords, readCatalog } from "../first-screen.js";
import { Ready, READY_ATTRIBUTE } from "../src/first-ready.js";

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

/** Put the screen in the page as the browser would, and run its script. */
function open(opts: { languages?: string[]; search?: string; hash?: string; storage?: Record<string, string> } = {}): HTMLElement | null {
  localStorage.clear();
  for (const [key, value] of Object.entries(opts.storage ?? {})) localStorage.setItem(key, value);
  Object.defineProperty(navigator, "languages", { value: opts.languages ?? ["en-US"], configurable: true });
  history.replaceState(null, "", `/${opts.search ?? ""}${opts.hash ?? ""}`);
  const html = firstScreenHtml();
  const script = /<script>([\s\S]*)<\/script>$/.exec(html)![1]!;
  document.body.innerHTML = `<div id="root">${html.replace(/<script>[\s\S]*<\/script>$/, "")}</div>`;
  new Function(script)();
  return document.querySelector<HTMLElement>("[data-first-screen]");
}

const heading = (screen: HTMLElement | null): string | undefined => screen?.querySelector("h2")?.textContent ?? undefined;

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-first-screen");
  document.documentElement.removeAttribute(READY_ATTRIBUTE);
});
afterEach(cleanup);

describe("the words", () => {
  it("are the ones launcher.tsx shows, so the catalogs know them", () => {
    const launcher = read("../src/launcher.tsx");
    for (const words of Object.values(FIRST_SCREEN_WORDS)) expect(launcher).toContain(words);
  });

  it("come from every language's catalog", () => {
    const words = firstScreenWords();
    expect(Object.keys(words).sort()).toEqual(["de", "en", "es", "it", "pl", "pt-BR"]);
    expect(words.en!.heading).toBe("Make the app you need");
    expect(words.de!.heading).toBe(readCatalog(read("../../i18n/locales/de/messages.po")).get("Make the app you need"));
    expect(words.de!.heading).not.toBe(words.en!.heading);
  });

  it("refuses a catalog that lacks one, instead of showing English", () => {
    expect(() => firstScreenWords(() => 'msgid "Something else"\nmsgstr "x"\n')).toThrow(/has no words/);
  });

  it("reads an entry written over several lines", () => {
    expect(readCatalog('msgid ""\n"Make the "\n"app"\nmsgstr ""\n"Mach "\n"die App"\n').get("Make the app")).toBe("Mach die App");
  });
});

describe("what a visit shows first", () => {
  it("index.html asks for the screen inside #root, so React's first render replaces it", () => {
    expect(read("../index.html")).toContain(`<div id="root">${FIRST_SCREEN_SLOT}</div>`);
  });

  it("a first visit in English: the wordmark, the heading and the line under it", () => {
    const screen = open();
    expect(screen?.querySelector(".k-wordmark img")).not.toBeNull();
    expect(heading(screen)).toBe("Make the app you need");
    expect(document.documentElement.hasAttribute("data-first-screen")).toBe(true);
  });

  it("a first visit on a German device reads German, and a saved language wins over the device", () => {
    expect(heading(open({ languages: ["de-AT", "en"] }))).toBe(firstScreenWords().de!.heading);
    expect(document.documentElement.lang).toBe("de");
    expect(heading(open({ languages: ["de"], storage: { "potyro:locale": "pt-BR" } }))).toBe(firstScreenWords()["pt-BR"]!.heading);
    expect(heading(open({ languages: ["pt-PT"] }))).toBe(firstScreenWords()["pt-BR"]!.heading);
    expect(heading(open({ languages: ["ja", "fr"] }))).toBe("Make the app you need");
  });

  it("someone who has opened an app, or said Not now, gets the wordmark only", () => {
    const opened = open({ storage: { "potyro:launcher": JSON.stringify({ "user:split": { openCount: 3 } }) } });
    expect(opened?.querySelector(".k-wordmark")).not.toBeNull();
    expect(opened?.querySelector("h2")).toBeNull();
    expect(open({ storage: { "potyro:welcome:dismissed": "1" } })?.querySelector("h2")).toBeNull();
    // Seeded and never opened is still a first visit.
    expect(heading(open({ storage: { "potyro:launcher": JSON.stringify({ "user:split": { openCount: 0 } }) } }))).toBe("Make the app you need");
  });

  it("a visit that opens something else, or the Start home screen, gets nothing of Home's", () => {
    for (const visit of [{ search: "?user=split" }, { search: "?data" }, { search: "?move=abc" }, { hash: "#join=abc" }, { hash: "#app=abc" }, { storage: { "potyro:look": JSON.stringify({ appearance: "system", launcher: "start" }) } }]) {
      expect(open(visit), JSON.stringify(visit)).toBeNull();
      expect(document.documentElement.hasAttribute("data-first-screen")).toBe(false);
      document.documentElement.removeAttribute("data-first-screen");
    }
    // An install link and the words from the site's prompt box open over Home.
    expect(open({ hash: "#add=https%3A%2F%2Fexample.org%2Fa.zip" })).not.toBeNull();
    expect(open({ search: "?new=a%20shopping%20list" })).not.toBeNull();
  });

  it("puts a chosen dark look on the page before anything is drawn", () => {
    open({ storage: { "potyro:look": JSON.stringify({ appearance: "dark" }) } });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("survives storage that throws and a look that is not JSON", () => {
    expect(open({ storage: { "potyro:look": "{not json" } })).not.toBeNull();
  });
});

describe("the mark that the first real screen is up", () => {
  it("is absent while the page's own first screen is all there is", () => {
    open();
    expect(document.documentElement.dataset.potyroReady).toBeUndefined();
  });

  it("is set once a real screen has rendered", () => {
    open();
    render(
      <>
        <main>Home</main>
        <Ready />
      </>,
    );
    expect(document.documentElement.dataset.potyroReady).toBe("1");
  });
});
