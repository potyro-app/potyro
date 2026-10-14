// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { messages as en } from "../locales/en/messages.po";
import {
  LOCALE_KEY,
  PSEUDO_LOCALE,
  fmt,
  i18n,
  initialLocale,
  resetI18nForTests,
  savedLocale,
  setLocale,
  setPseudoAvailable,
  setSystemLanguages,
  startI18n,
  withFallback,
} from "../src/index.js";

/** The id of an English message, found by its English — the catalog is keyed by hash. */
function idOf(english: string): string {
  const hit = Object.entries(en).find(([, m]) => (Array.isArray(m) ? m.join("") : m) === english);
  if (!hit) throw new Error(`no message "${english}" in the English catalog`);
  return hit[0];
}

const setBrowserLanguages = (langs: string[]): void => {
  Object.defineProperty(navigator, "languages", { value: langs, configurable: true });
};

beforeEach(() => {
  localStorage.clear();
  resetI18nForTests();
  setBrowserLanguages(["en-US"]);
});
afterEach(() => cleanup());

describe("fallback, per message", () => {
  it("lays a translation over English and fills every gap", () => {
    const merged = withFallback({ a: "A-pl", b: "", c: [] }, { a: "A", b: "B", c: "C", d: "D" });
    expect(merged).toEqual({ a: "A-pl", b: "B", c: "C", d: "D" });
  });

  it("shows a language's own catalog once it is chosen", async () => {
    await setLocale("pl");
    expect(i18n.locale).toBe("pl");
    expect(i18n._(idOf("History"))).toBe("Historia");
    expect(document.documentElement.lang).toBe("pl");
  });
});

describe("choosing", () => {
  it("starts in the device's language", async () => {
    setBrowserLanguages(["pl-PL", "en"]);
    expect(await startI18n()).toBe("pl");
  });

  it("prefers the native system locale once the shell reports it", async () => {
    setBrowserLanguages(["en-US"]);
    await startI18n();
    expect(i18n.locale).toBe("en");
    await setSystemLanguages(["de-DE"]);
    expect(i18n.locale).toBe("de");
  });

  it("saves a choice on the device, and 'auto' forgets it", async () => {
    setBrowserLanguages(["es-ES"]);
    await setLocale("it");
    expect(localStorage.getItem(LOCALE_KEY)).toBe("it");
    expect(initialLocale()).toBe("it");
    await setLocale("auto");
    expect(localStorage.getItem(LOCALE_KEY)).toBeNull();
    expect(savedLocale()).toBe("auto");
    expect(i18n.locale).toBe("es");
  });

  it("refuses a language this build does not have, and the pseudo-language unless offered", async () => {
    await expect(setLocale("fr")).rejects.toThrow(/Unknown language/);
    await expect(setLocale(PSEUDO_LOCALE)).rejects.toThrow(/Unknown language/);
    setPseudoAvailable(true);
    await setLocale(PSEUDO_LOCALE);
    expect(i18n.locale).toBe(PSEUDO_LOCALE);
    expect(document.documentElement.lang).toBe("en");
  });
});

describe("the pseudo-language", () => {
  it("accents, brackets and pads every catalog message, plurals included", async () => {
    setPseudoAvailable(true);
    await setLocale(PSEUDO_LOCALE);
    expect(i18n._(idOf("History"))).toMatch(/^⟦Ĥîšţöŕý ·+⟧$/);
    const plural = Object.entries(en).find(([, m]) => JSON.stringify(m).includes(" messages"))![0];
    expect(i18n._(plural, { 0: 1 })).toMatch(/^⟦1 ɱéššåĝé ·+⟧$/);
    expect(i18n._(plural, { 0: 3 })).toMatch(/^⟦3 ɱéššåĝéš ·+⟧$/);
  });

  it("marks formatted values too, so a raw toLocaleString stands out", async () => {
    setPseudoAvailable(true);
    await setLocale(PSEUDO_LOCALE);
    expect(fmt.list(["a", "b"])).toBe("å åñð ƀ");
    expect(fmt.language("pl")).toBe("Þöļîšĥ");
  });
});

function Probe() {
  const { t } = useLingui();
  return (
    <p>
      <Trans>History</Trans> | {t`Find an app`}
    </p>
  );
}

describe("React", () => {
  it("renders without a provider and switches live, with no remount", async () => {
    render(<Probe />);
    expect(screen.getByText(/History/).textContent).toBe("History | Find an app");
    setPseudoAvailable(true);
    await act(() => setLocale(PSEUDO_LOCALE));
    expect(screen.getByText(/Ĥîšţöŕý/).textContent).toMatch(/^⟦Ĥîšţöŕý ·+⟧ \| ⟦Ƒîñð åñ åþþ ·+⟧$/);
    await act(() => setLocale("en"));
    expect(screen.getByText(/History/).textContent).toBe("History | Find an app");
  });
});
