import { describe, expect, it } from "vitest";
import { LOCALES, PSEUDO_LOCALE, deviceLocale, intlLocale, matchLocale, normalizeTag, resolveLocale } from "../src/locale.js";

describe("normalizeTag", () => {
  it("spells a tag one way", () => {
    expect(normalizeTag("pt_br")).toBe("pt-BR");
    expect(normalizeTag("PT-br")).toBe("pt-BR");
    expect(normalizeTag("zh-hant-tw")).toBe("zh-Hant-TW");
    expect(normalizeTag(" de ")).toBe("de");
  });

  it("is null for what is not a language", () => {
    for (const raw of ["", "*", "und", "x", "12", null, undefined]) expect(normalizeTag(raw)).toBeNull();
  });
});

describe("matchLocale", () => {
  const ours = [...LOCALES];

  it("takes an exact match", () => {
    expect(matchLocale(["pt-BR"], ours, "en")).toBe("pt-BR");
    expect(matchLocale(["it"], ours, "en")).toBe("it");
  });

  it("takes the same language in another region", () => {
    expect(matchLocale(["pl-PL"], ours, "en")).toBe("pl");
    expect(matchLocale(["de-AT"], ours, "en")).toBe("de");
    expect(matchLocale(["es-MX"], ours, "en")).toBe("es");
    expect(matchLocale(["pt-PT"], ours, "en")).toBe("pt-BR");
    expect(matchLocale(["pt"], ours, "en")).toBe("pt-BR");
    expect(matchLocale(["en-GB"], ours, "en")).toBe("en");
  });

  it("prefers the first language's region over the second language exactly", () => {
    // A Portuguese speaker is better served by pt-BR than by their fallback of English.
    expect(matchLocale(["pt-PT", "en-US"], ours, "en")).toBe("pt-BR");
  });

  it("walks the person's list until one is available", () => {
    expect(matchLocale(["fr-FR", "nl", "de-CH", "en"], ours, "en")).toBe("de");
  });

  it("falls back when nothing matches", () => {
    expect(matchLocale(["fr", "ja"], ours, "en")).toBe("en");
    expect(matchLocale([], ours, "en")).toBe("en");
    expect(matchLocale(["*", null, ""], ours, "en")).toBe("en");
  });

  it("answers in the spelling of the available list, and breaks ties by its order", () => {
    expect(matchLocale(["pt_br"], ["en", "pt-BR"], "en")).toBe("pt-BR");
    // #302: an app's own languages, its default first.
    expect(matchLocale(["pt-PT"], ["pt-BR", "pt-PT"], "en")).toBe("pt-PT");
    expect(matchLocale(["pt-AO"], ["pt-PT", "pt-BR"], "en")).toBe("pt-PT");
  });
});

describe("deviceLocale / resolveLocale", () => {
  it("puts the native system locale before the browser's", () => {
    expect(deviceLocale({ browser: ["en-US"], system: ["pl-PL"] })).toBe("pl");
    expect(deviceLocale({ browser: ["it-IT", "en"], system: null })).toBe("it");
    expect(deviceLocale({ browser: [] })).toBe("en");
  });

  it("honours a saved language over the device", () => {
    expect(resolveLocale("de", { browser: ["pl-PL"] })).toBe("de");
  });

  it("follows the device for auto, nothing, or a tag this build does not know", () => {
    expect(resolveLocale("auto", { browser: ["pl-PL"] })).toBe("pl");
    expect(resolveLocale(null, { browser: ["es"] })).toBe("es");
    expect(resolveLocale("fr", { browser: ["es"] })).toBe("es");
  });

  it("only resolves to the pseudo-language where it is offered", () => {
    expect(resolveLocale(PSEUDO_LOCALE, { browser: ["en"] }, { pseudo: true })).toBe(PSEUDO_LOCALE);
    expect(resolveLocale(PSEUDO_LOCALE, { browser: ["pl"] })).toBe("pl");
  });

  it("formats the pseudo-language as English", () => {
    expect(intlLocale(PSEUDO_LOCALE)).toBe("en");
    expect(intlLocale("pl")).toBe("pl");
  });
});
