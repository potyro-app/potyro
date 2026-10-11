// @vitest-environment happy-dom
//
// What this device looks like (#224).
//
// The palette was built for a manual toggle from the start — light under `:root`, dark under
// `prefers-color-scheme: dark`, and `[data-theme]` on the root beating both "so a manual toggle
// can". Nothing set it. What is pinned here is that setting it does the right thing, and that
// "system" means the media query is back in charge rather than frozen to whatever it said at boot.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyLook, readLook, setLook, accentColour, DEFAULT_LOOK } from "../src/look.js";

const root = (): HTMLElement => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  root().removeAttribute("data-theme");
  root().style.removeProperty("--accent");
});
afterEach(() => localStorage.clear());

describe("the device's look", () => {
  it("follows the system until someone says otherwise", () => {
    expect(readLook()).toEqual(DEFAULT_LOOK);
    applyLook();
    // No attribute at all: `prefers-color-scheme` decides, which is what "System" means.
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("stamps a deliberate choice on the root, where the palette is waiting for it", () => {
    setLook({ appearance: "dark" });
    expect(root().getAttribute("data-theme")).toBe("dark");

    setLook({ appearance: "light" });
    expect(root().getAttribute("data-theme")).toBe("light");
  });

  it("hands the decision back to the system when you choose System again", () => {
    setLook({ appearance: "dark" });
    setLook({ appearance: "system" });
    // Removed, not set to "light": a device that switches itself at sunset must still switch.
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("survives a reload", () => {
    setLook({ appearance: "dark", accent: 205 });
    expect(readLook()).toEqual({ appearance: "dark", accent: 205 });
  });

  it("sets the accent as a colour on the root, and takes it off again", () => {
    setLook({ appearance: "system", accent: 205 });
    expect(root().style.getPropertyValue("--accent")).toBe("oklch(72% 0.13 205)");
    expect(accentColour()).toBe("oklch(72% 0.13 205)");

    // Back to Potyro's own: the property is removed rather than set to gold, so the stylesheet's
    // own value (and any future change to it) is what shows.
    setLook({ appearance: "system" });
    expect(root().style.getPropertyValue("--accent")).toBe("");
    expect(accentColour()).toBeNull();
  });

  it("reads a damaged or ancient setting as the default rather than throwing", () => {
    localStorage.setItem("potyro:look", "{not json");
    expect(readLook()).toEqual(DEFAULT_LOOK);

    localStorage.setItem("potyro:look", JSON.stringify({ appearance: "chartreuse", accent: "blue" }));
    expect(readLook()).toEqual(DEFAULT_LOOK);
  });
});
