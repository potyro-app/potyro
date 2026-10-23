// @vitest-environment happy-dom
// An app's own theme (#423): the device's choice for it wins over the app's own, which wins over
// the system's; on the document while the app is open, the Look's own back after.
import { afterEach, describe, expect, it } from "vitest";
import { appAppearance, themeClass } from "../src/app-theme.js";
import { updateEntry } from "../src/launcher-store.js";

afterEach(() => localStorage.clear());

describe("appAppearance", () => {
  it("is the system's with nothing said", () => {
    expect(appAppearance("user:x", undefined)).toBe("system");
    expect(appAppearance(undefined, { theme: {} })).toBe("system");
  });

  it("takes the app's own, and the device's choice for it over that", () => {
    expect(appAppearance("user:x", { theme: { appearance: "dark" } })).toBe("dark");
    updateEntry("user:x", { appearance: "light" });
    expect(appAppearance("user:x", { theme: { appearance: "dark" } })).toBe("light");
    updateEntry("user:x", { appearance: "system" });
    expect(appAppearance("user:x", { theme: { appearance: "dark" } })).toBe("system");
  });
});

describe("themeClass", () => {
  it("names the class for a theme, none for the system's", () => {
    expect(themeClass("dark")).toBe("k-theme-dark");
    expect(themeClass("light")).toBe("k-theme-light");
    expect(themeClass("system")).toBeUndefined();
  });
});
