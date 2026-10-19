// The codemod that moved the examples' and showcase apps' inline maps into catalogs (docs/30 §7).

import { describe, expect, it } from "vitest";
import { convert } from "../src/maps-to-po.js";

const SOURCE = `import { defineApp } from "potyro";
const EMPTY = { en: "Nothing yet", pl: "Jeszcze nic" };
export const LANG_NAMES = { en: "English", pl: "Polski" } as const;
export default defineApp({
  id: "a", name: "A", version: "1.0.0", schemaVersion: 1, language: "en", languages: ["en", "pl"],
  entities: { item: { label: { en: "Item", pl: "Rzecz" }, fields: { name: { type: "text", label: { en: "Water", pl: "Woda" } } },
    actions: { water: { label: { en: "Water", pl: "Podlej" }, run: async (r, ctx) => ctx.ui.toast(ctx.t({ en: "Done {n}", pl: "Gotowe {n}" }, { n: 1 })) } } } },
  pages: [{ id: "p", title: "P", view: { type: "list", entity: "item", emptyText: EMPTY } }],
});
`;

describe("convert", () => {
  const out = convert(SOURCE, "en");
  const pl = Object.fromEntries(out.catalogs.pl ?? []);

  it("turns slot maps and ctx.t maps into their own-language strings, the rest into the catalog", () => {
    expect(out.source).toContain('label: "Item"');
    expect(out.source).toContain('ctx.t("Done {n}", { n: 1 })');
    expect(pl).toMatchObject({ Item: "Rzecz", "Done {n}": "Gotowe {n}" });
  });

  it("marks a map kept in a const with msg, and imports it", () => {
    expect(out.source).toContain('const EMPTY = msg("Nothing yet")');
    expect(out.source).toMatch(/import \{[^}]*\bmsg\b[^}]*\} from "potyro"/);
    expect(pl["Nothing yet"]).toBe("Jeszcze nic");
  });

  it("tells apart one text translated two ways with a context, keeping both translations", () => {
    const water = Object.entries(pl).filter(([k]) => k.endsWith("Water")).map(([, v]) => v).sort();
    expect(water).toEqual(["Podlej", "Woda"]);
    expect(out.contexts).toBeGreaterThan(0);
  });

  it("leaves a map under `as const` alone: data looked up by language, not words", () => {
    expect(out.source).toContain('LANG_NAMES = { en: "English", pl: "Polski" } as const');
    expect(pl.English).toBeUndefined();
    expect(out.reports.some((r) => r.includes("as const"))).toBe(true);
  });
});
