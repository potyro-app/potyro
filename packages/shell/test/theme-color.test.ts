// @vitest-environment happy-dom
//
// The browser's bar follows a CHOSEN theme (#123): index.html has one theme-color per system theme,
// which a dark Look on a light phone (or an app in its own theme) cannot reach through the media
// queries. Added to the home screen that was a white status bar over a dark app.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { followThemeColor } from "../src/theme-color.js";

const colours = () => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute("content"));
const settle = () => new Promise((r) => setTimeout(r, 0));

let stop: () => void = () => {};
beforeEach(() => {
  document.head.innerHTML = `
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#1c1b1c" media="(prefers-color-scheme: dark)" />`;
  document.documentElement.removeAttribute("data-theme");
});
afterEach(() => {
  stop();
  document.documentElement.removeAttribute("data-theme");
});

describe("theme-color", () => {
  it("leaves each system theme its own colour while no theme is chosen", () => {
    stop = followThemeColor(document);
    expect(colours()).toEqual(["#ffffff", "#1c1b1c"]);
  });

  it("says the chosen theme's colour on every tag, and gives each its own back after", async () => {
    stop = followThemeColor(document);
    document.documentElement.setAttribute("data-theme", "dark");
    await settle();
    expect(colours()).toEqual(["#1c1b1c", "#1c1b1c"]);
    document.documentElement.setAttribute("data-theme", "light");
    await settle();
    expect(colours()).toEqual(["#ffffff", "#ffffff"]);
    document.documentElement.removeAttribute("data-theme");
    await settle();
    expect(colours()).toEqual(["#ffffff", "#1c1b1c"]);
  });

  it("follows a theme chosen before it started", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    stop = followThemeColor(document);
    expect(colours()).toEqual(["#1c1b1c", "#1c1b1c"]);
  });
});
