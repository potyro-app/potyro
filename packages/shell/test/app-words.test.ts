// @vitest-environment happy-dom
// The shell around an app's words (#302, docs/20 §3.2–3.3): which name a tile says, where the
// person's languages come from, and the quiet line for an app that lacks theirs.

import { afterEach, describe, expect, it, vi } from "vitest";
import { isRtl, languageName, languageNote, ownName, shownName } from "../src/app-words.js";
import { LOCALE_KEY, chosenLanguage, languagePrefs, onLanguagePrefsChange } from "../src/locale.js";
import { setLocale } from "@potyro/i18n";
import { inspect } from "../src/app-source.js";

const groceries = { name: { en: "Groceries", pl: "Zakupy" }, language: "en", languages: ["en", "pl"] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("an app's name", () => {
  it("is stored in the app's own language, and shown in the person's", () => {
    expect(ownName(groceries)).toBe("Groceries");
    expect(shownName("Groceries", groceries, ["pl-PL"])).toBe("Zakupy");
    expect(shownName(undefined, groceries, ["en-GB"])).toBe("Groceries");
  });

  it("a name the person gave it wins as it is", () => {
    expect(shownName("Mum's list", groceries, ["pl"])).toBe("Mum's list");
  });

  it("a one-language app is unchanged", () => {
    expect(shownName("Plants", { name: "Plants" }, ["pl"])).toBe("Plants");
  });

  it("the launcher reads the map from the source without running it", async () => {
    const shape = await inspect(`import { defineApp } from "potyro";
export default defineApp({ id: "g", name: { en: "Groceries", pl: "Zakupy" }, language: "en", languages: ["en", "pl"], version: "1.0.0", schemaVersion: 1, entities: {}, pages: [] });`);
    expect(shape).toMatchObject({ name: "Groceries", names: { en: "Groceries", pl: "Zakupy" }, language: "en", languages: ["en", "pl"] });
  });
});

describe("the person's languages", () => {
  const store = (value: string | null) => ({ getItem: (k: string) => (k === LOCALE_KEY ? value : null) });

  it("an explicit choice wins outright over the device", () => {
    vi.stubGlobal("localStorage", store("en"));
    vi.stubGlobal("navigator", { languages: ["de-DE", "de"], language: "de-DE" });
    expect(chosenLanguage()).toBe("en");
    expect(languagePrefs()).toEqual(["en"]);
  });

  it("otherwise the device's whole list, in order", () => {
    vi.stubGlobal("localStorage", store(null));
    vi.stubGlobal("navigator", { languages: ["fr-FR", "pl"], language: "fr-FR" });
    expect(languagePrefs()).toEqual(["fr-FR", "pl"]);
  });

  it("is heard when it changes under You → Language, or on the device", async () => {
    const heard = vi.fn();
    const stop = onLanguagePrefsChange(heard);
    await setLocale("pl");
    globalThis.dispatchEvent(new Event("languagechange"));
    stop();
    await setLocale("en");
    globalThis.dispatchEvent(new Event("languagechange"));
    expect(heard.mock.calls.length).toBeGreaterThanOrEqual(2);
    const after = heard.mock.calls.length;
    await setLocale("de");
    expect(heard.mock.calls.length).toBe(after);
    await setLocale("auto");
  });
});

describe("the quiet line (docs/20 §3.3)", () => {
  it("says which language an app is in when it lacks the person's, and offers theirs", () => {
    expect(languageNote({ language: "en" }, ["pl-PL"], "en")).toEqual({ line: "This app is in English.", into: { tag: "pl", name: "Polski" }, offer: "Translate into Polski" });
  });

  it("says nothing when the app has the person's language, or declares none", () => {
    expect(languageNote(groceries, ["pl-PL"])).toBeNull();
    expect(languageNote({}, ["pl-PL"])).toBeNull();
  });

  it("names languages as their speakers do", () => {
    expect(languageName("de")).toBe("Deutsch");
    expect(languageName("pl", "en")).toBe("Polish");
  });

  it("knows the right-to-left scripts (a first step: dir on the app root)", () => {
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("he-IL")).toBe(true);
    expect(isRtl("pl")).toBe(false);
    expect(isRtl(undefined)).toBe(false);
  });
});
