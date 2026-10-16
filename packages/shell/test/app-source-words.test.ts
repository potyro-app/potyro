// The structural editor on a translated app (#302, docs/20 §5.1): a label or title written as a
// translation map is located per language, and saving one language writes that entry only —
// everything else in the file stays byte for byte.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyEdit, inspect, textSites } from "../src/app-source.js";
import { editorLanguages } from "../src/app-source-words.js";

const groceries = readFileSync(resolve(process.cwd(), "../../examples/groceries.app.ts"), "utf8");

/** Groceries' Note label as it ships, in six languages. */
const NOTE = `label: { en: "Note", "pt-BR": "Observação", de: "Notiz", es: "Nota", pl: "Notatka", it: "Nota" }`;

describe("a translated app in the structural editor", () => {
  it("locates a label and a title per language, with the app's languages", async () => {
    const shape = await inspect(groceries);
    // Groceries carries the six languages the shell ships (#303).
    expect(shape).toMatchObject({ language: "en", languages: ["en", "pt-BR", "de", "es", "pl", "it"], names: expect.objectContaining({ en: "Groceries", pl: "Zakupy" }) });
    const quantity = shape.entities.find((e) => e.key === "item")!.fields.find((f) => f.key === "quantity")!;
    expect(quantity).toMatchObject({ labels: { en: "Quantity", "pt-BR": "Quantidade", de: "Menge", es: "Cantidad", pl: "Ilość", it: "Quantità" } });
    expect(quantity.labelOpaque).toBeUndefined();
    expect(shape.pages.find((p) => p.id === "shopping")).toMatchObject({ titles: expect.objectContaining({ en: "List", pl: "Lista" }) });
  });

  it("writes one language of a label, and nothing else moves", async () => {
    const out = await applyEdit(groceries, { kind: "field-label", entity: "item", field: "quantity", value: "Liczba", language: "pl" });
    expect(out.ok).toBe(true);
    const next = out.ok ? out.source : "";
    expect(next).toContain(`label: { en: "Quantity", "pt-BR": "Quantidade", de: "Menge", es: "Cantidad", pl: "Liczba", it: "Quantità" }`);
    expect(next.replace(`pl: "Liczba"`, `pl: "Ilość"`)).toBe(groceries);
  });

  it("adds a language a map does not have yet, and retitles a page in one language", async () => {
    // Every map in the shipped app has all six, so the gap is made here: a note label in two.
    const partial = groceries.replace(NOTE, `label: { en: "Note", pl: "Notatka" }`);
    const added = await applyEdit(partial, { kind: "field-label", entity: "item", field: "note", value: "Notiz", language: "de" });
    expect(added.ok && added.source).toContain(`label: { en: "Note", pl: "Notatka", de: "Notiz" }`);
    const page = await applyEdit(groceries, { kind: "page-title", page: "shopping", value: "Zakupy", language: "pl" });
    expect(page.ok && page.source).toContain(`es: "Lista", pl: "Zakupy", it: "Lista" }`);
  });

  it("refuses an empty translation, and a language edit on a plain label", async () => {
    expect(await applyEdit(groceries, { kind: "field-label", entity: "item", field: "quantity", value: " ", language: "pl" })).toMatchObject({ ok: false });
    const plain = groceries.replace(NOTE, `label: "Note"`);
    expect(await applyEdit(plain, { kind: "field-label", entity: "item", field: "note", value: "Notatka", language: "pl" })).toMatchObject({ ok: false, reason: "this label is not written as a translation map" });
  });

  it("edit mode offers each language of a displayed map, and still not a placeholder's", async () => {
    const texts = (await textSites(groceries)).map((s) => s.text);
    expect(texts).toContain("Lista jest pusta. Dodaj pierwszą rzecz poniżej albo przywróć stałe.");
    expect(texts).toContain("Nothing on the list. Add the first thing below, or bring back your usuals.");
    expect(texts).not.toContain("Milk"); // placeholder: { en: "Milk", … } reads like a record
  });

  it("orders the inputs: the app's own language first", () => {
    expect(editorLanguages({ pl: "Ilość", en: "Quantity", de: "Menge" }, "en", ["en", "pl"])).toEqual(["en", "pl", "de"]);
  });
});
