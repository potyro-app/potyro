// An icon is a Lucide name or one emoji (#425): the validator takes both, and nothing in between.
import { describe, expect, it } from "vitest";
import { defineApp, isIcon, isLucideName } from "../src/index.js";

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
