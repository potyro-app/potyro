// The structural editor on a translated app (#302, docs/20 §5.1): a label or title written as a
// translation map is located per language, and saving one language writes that entry only —
// everything else in the file stays byte for byte.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyEdit, inspect } from "../src/app-source.js";
import { editorLanguages } from "../src/app-source-words.js";

const groceries = readFileSync(resolve(process.cwd(), "../../examples/groceries.app.ts"), "utf8");

describe("a translated app in the structural editor", () => {
  it("locates a label and a title per language, with the app's languages", async () => {
    const shape = await inspect(groceries);
    expect(shape).toMatchObject({ language: "en", languages: ["en", "pl"], names: { en: "Groceries", pl: "Zakupy" } });
    const quantity = shape.entities.find((e) => e.key === "item")!.fields.find((f) => f.key === "quantity")!;
    expect(quantity).toMatchObject({ labels: { en: "Quantity", pl: "Ilość" } });
    expect(quantity.labelOpaque).toBeUndefined();
    expect(shape.pages.find((p) => p.id === "shopping")).toMatchObject({ titles: { en: "Shopping", pl: "Zakupy" } });
  });

  it("writes one language of a label, and nothing else moves", async () => {
    const out = await applyEdit(groceries, { kind: "field-label", entity: "item", field: "quantity", value: "Liczba", language: "pl" });
    expect(out.ok).toBe(true);
    const next = out.ok ? out.source : "";
    expect(next).toContain(`label: { en: "Quantity", pl: "Liczba" }`);
    expect(next.replace(`pl: "Liczba"`, `pl: "Ilość"`)).toBe(groceries);
  });

  it("adds a language a map does not have yet, and retitles a page in one language", async () => {
    const added = await applyEdit(groceries, { kind: "field-label", entity: "item", field: "note", value: "Notiz", language: "de" });
    expect(added.ok && added.source).toContain(`label: { en: "Note", pl: "Notatka", de: "Notiz" }`);
    const page = await applyEdit(groceries, { kind: "page-title", page: "shopping", value: "Lista", language: "pl" });
    expect(page.ok && page.source).toContain(`title: { en: "Shopping", pl: "Lista" }`);
  });

  it("refuses an empty translation, and a language edit on a plain label", async () => {
    expect(await applyEdit(groceries, { kind: "field-label", entity: "item", field: "quantity", value: " ", language: "pl" })).toMatchObject({ ok: false });
    const plain = groceries.replace(`label: { en: "Note", pl: "Notatka" }`, `label: "Note"`);
    expect(await applyEdit(plain, { kind: "field-label", entity: "item", field: "note", value: "Notatka", language: "pl" })).toMatchObject({ ok: false, reason: "this label is not written as a translation map" });
  });

  it("orders the inputs: the app's own language first", () => {
    expect(editorLanguages({ pl: "Ilość", en: "Quantity", de: "Menge" }, "en", ["en", "pl"])).toEqual(["en", "pl", "de"]);
  });
});
