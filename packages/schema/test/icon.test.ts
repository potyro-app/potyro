// An icon is a Lucide name or one emoji (#425): the validator takes both, and nothing in between.
import { describe, expect, it } from "vitest";
import { defineApp, iconKind, isIcon, isImageIcon, isImagePath, isLucideName } from "../src/index.js";

const app = (icon: string, where: "app" | "entity" | "page" | "action") =>
  defineApp({
    id: "t",
    name: "T",
    version: "1.0.0",
    schemaVersion: 1,
    language: "en",
    ...(where === "app" ? { icon } : {}),
    entities: { plant: { ...(where === "entity" ? { icon } : {}), fields: { name: { type: "text" } } } },
    pages: [
      {
        id: "p",
        title: "P",
        ...(where === "page" ? { icon } : {}),
        actions: where === "action" ? [{ label: "Go", icon, run: () => {} }] : [],
        view: { type: "list", entity: "plant" },
      },
    ],
  });

describe("isLucideName / isIcon", () => {
  it("knows the shape of a name", () => {
    expect(isLucideName("shopping-cart")).toBe(true);
    expect(isLucideName("a-arrow-down")).toBe(true);
    expect(isLucideName("🛒")).toBe(false);
    expect(isLucideName("ShoppingCart")).toBe(false);
    expect(isLucideName("shopping cart")).toBe(false);
  });

  it("takes a name or one emoji, not a word", () => {
    expect(isIcon("shopping-cart")).toBe(true);
    expect(isIcon("🛒")).toBe(true);
    expect(isIcon("🗺️")).toBe(true);
    expect(isIcon("＋")).toBe(true);
    expect(isIcon("Shopping Cart!")).toBe(false);
    expect(isIcon("")).toBe(false);
  });
});

describe("defineApp", () => {
  for (const where of ["app", "entity", "page", "action"] as const) {
    it(`takes a Lucide name as the ${where}'s icon, and still an emoji`, () => {
      expect(() => app("message-circle-question-mark", where)).not.toThrow();
      expect(() => app("🛒", where)).not.toThrow();
      expect(() => app("Shopping Cart!", where)).toThrow(/Lucide name/);
    });
  }
});

describe("pictures as icons (#425)", () => {
  it("knows a shipped file's path, an inline <svg> and a data: image", () => {
    expect(isImageIcon("icon.svg")).toBe(true);
    expect(isImagePath("art/logo.png")).toBe(true);
    expect(isImageIcon("<svg viewBox=\"0 0 24 24\"><path d=\"M1 1\"/></svg>")).toBe(true);
    expect(isImagePath("<svg/>")).toBe(false);
    expect(isImageIcon("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isImageIcon("data:text/html,<b>x</b>")).toBe(false);
    expect(isImageIcon("../secret.png")).toBe(false);
    expect(isImageIcon("https://example.com/a.png")).toBe(false);
    expect(isImageIcon("shopping-cart")).toBe(false);
    expect(isImageIcon("🛒")).toBe(false);
    expect(iconKind("icon.svg")).toBe("image");
    expect(iconKind("shopping-cart")).toBe("lucide");
    expect(iconKind("🛒")).toBe("glyph");
  });

  it("defineApp takes a picture as the app's icon, within its size", () => {
    expect(() => app("icon.svg", "app")).not.toThrow();
    expect(() => app("<svg viewBox=\"0 0 24 24\"><path d=\"M1 1\"/></svg>", "entity")).not.toThrow();
    expect(() => app(`<svg>${"x".repeat(70_000)}</svg>`, "app")).toThrow();
  });
});
