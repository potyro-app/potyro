// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { resetI18nForTests, setPseudoAvailable, setSystemLanguages } from "@potyro/i18n";
import { LANGUAGE_SELECT_ID, LanguagePicker } from "../src/language-picker.js";

// You → Language is a native select (#298): "Match this device" first, saying which language that
// is, then each language named in itself, in the current language, and whether it is a draft.

function picker(): HTMLSelectElement {
  render(
    <>
      <label htmlFor={LANGUAGE_SELECT_ID}>Language</label>
      <LanguagePicker />
    </>,
  );
  return screen.getByLabelText("Language") as HTMLSelectElement;
}

const labels = (select: HTMLSelectElement): Array<[string, string]> => [...select.options].map((o) => [o.value, o.text]);

beforeEach(async () => {
  localStorage.clear();
  await setSystemLanguages(["pl-PL"]);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetI18nForTests();
});

describe("the language select", () => {
  it("follows the device by default and names every language in itself, then in the current one", () => {
    const select = picker();
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("auto");
    expect(labels(select)).toEqual([
      // The device is Polish, so Potyro is: the picker reads in Polish (#300), the second name is in
      // Polish, and Polish is not named twice.
      ["auto", "Jak to urządzenie (Polski)"],
      ["en", "English — angielski"],
      // How `Intl` names Brazilian Portuguese in Polish depends on the ICU data; its shape does not.
      ["pt-BR", expect.stringMatching(/^Português \(Brasil\) — \S.* \(wersja robocza\)$/)],
      ["de", "Deutsch — niemiecki (wersja robocza)"],
      ["es", "Español — hiszpański (wersja robocza)"],
      ["pl", "Polski (wersja robocza)"],
      ["it", "Italiano — włoski (wersja robocza)"],
    ]);
  });

  it("offers the pseudo-language only when dev turns it on", () => {
    expect(labels(picker()).map(([v]) => v)).not.toContain("en-XA");
    cleanup();
    setPseudoAvailable(true);
    expect(labels(picker()).at(-1)?.[0]).toBe("en-XA");
  });

  it("switches live, saves the choice on this device, and 'Match this device' forgets it", async () => {
    const select = picker();
    await act(async () => {
      fireEvent.change(select, { target: { value: "de" } });
    });
    expect(select.value).toBe("de");
    expect(localStorage.getItem("potyro:locale")).toBe("de");
    // Re-rendered in German without a reload: the other languages are named in German now.
    await waitFor(() => expect(labels(select).find(([v]) => v === "pl")?.[1]).toBe("Polski — Polnisch (Entwurf)"));
    expect(labels(select).find(([v]) => v === "en")?.[1]).toBe("English — Englisch");

    await act(async () => {
      fireEvent.change(select, { target: { value: "auto" } });
    });
    expect(select.value).toBe("auto");
    expect(localStorage.getItem("potyro:locale")).toBeNull();
  });
});
