// The apps' icons (#425): every Lucide icon as one path, by name, loaded lazily.
import { describe, expect, it } from "vitest";
import { isLucideName, lucideKnown, lucideLoaded, lucidePath, lucideReady } from "../src/lucide.js";
import { LUCIDE_ALIASES, LUCIDE_PATHS } from "../src/lucide-paths.generated.js";

describe("the generated paths", () => {
  it("hold the whole set, each as one path in the 24-box", () => {
    expect(Object.keys(LUCIDE_PATHS).length).toBeGreaterThan(1800);
    for (const [name, d] of Object.entries(LUCIDE_PATHS)) {
      expect(name, name).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
      expect(d, name).toMatch(/^[Mm]/);
      expect(d, name).not.toMatch(/[^MmLlHhVvCcSsQqTtAaZz0-9 .,-]/);
    }
  });

  it("rewrote circles, rects and lines as path commands", () => {
    // shopping-cart: two paths and two circles → one path with two arc pairs.
    expect(LUCIDE_PATHS["shopping-cart"]).toContain("a2 2 0 1 0 4 0a2 2 0 1 0 -4 0");
    // square: a rect with rounded corners.
    expect(LUCIDE_PATHS["square"]).toMatch(/^M5 3h14a2 2 0 0 1 2 2v14/);
    // minus: a line.
    expect(LUCIDE_PATHS["minus"]).toBe("M5 12h14");
  });

  it("knows Lucide's older names", () => {
    expect(LUCIDE_ALIASES["edit"]).toBe("square-pen");
    expect(LUCIDE_ALIASES["home"]).toBe("house");
    for (const [alias, name] of Object.entries(LUCIDE_ALIASES)) {
      expect(LUCIDE_PATHS[name], alias).toBeDefined();
      expect(LUCIDE_PATHS[alias], alias).toBeUndefined();
    }
  });
});

describe("the loader", () => {
  it("tells a name's shape without loading", () => {
    expect(isLucideName("shopping-cart")).toBe(true);
    expect(isLucideName("gamepad-2")).toBe(true);
    expect(isLucideName("🛒")).toBe(false);
    expect(isLucideName("Shopping-Cart")).toBe(false);
    expect(isLucideName("x")).toBe(false);
    expect(isLucideName("-cart")).toBe(false);
    expect(isLucideName("")).toBe(false);
  });

  it("answers nothing before the load, and the path after it", async () => {
    // Fresh module state is this file's: nothing has been loaded yet.
    const before = lucideLoaded();
    if (!before) {
      expect(lucidePath("shopping-cart")).toBeUndefined();
      // Assumed drawable until known otherwise, so a tile never flashes a monogram first.
      expect(lucideKnown("no-such-icon-at-all")).toBe(true);
    }
    await lucideReady();
    expect(lucideLoaded()).toBe(true);
    expect(lucidePath("shopping-cart")).toBe(LUCIDE_PATHS["shopping-cart"]);
    expect(lucidePath("edit")).toBe(LUCIDE_PATHS["square-pen"]);
    expect(lucidePath("no-such-icon-at-all")).toBeUndefined();
    expect(lucideKnown("shopping-cart")).toBe(true);
    expect(lucideKnown("no-such-icon-at-all")).toBe(false);
    expect(lucideKnown("🛒")).toBe(false);
  });
});
