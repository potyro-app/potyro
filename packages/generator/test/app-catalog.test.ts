// An app's messages from its source, and its catalogs kept in step (docs/30).

import { describe, expect, it } from "vitest";
import { compileCatalog, readPo } from "@potyro/i18n/app-catalogs";
import { extractMessages, likeness, mergeCatalog, writeTemplate } from "../src/app-catalog.js";

const SOURCE = `import { defineApp } from "potyro";
const n = 3;
export default defineApp({
  id: "plants", name: "Plants", version: "1.0.0", schemaVersion: 1, language: "en",
  entities: { plant: { label: "Plant", fields: {
    name: { type: "text", label: "Name", placeholder: "Fern" },
    kind: { type: "enum", options: ["fern", "cactus"], labels: { fern: "Fern", cactus: "Cactus" } },
  },
  actions: { water: { label: "Water", run: async (p, ctx) => ctx.ui.toast(ctx.t("Watered {name}", { name: p.name })) } } } },
  pages: [{ id: "today", title: "Today", view: { type: "list", entity: "plant",
    display: { primary: "name", secondary: (p, ctx) => ctx.t("{n, plural, one {# day} other {# days}}", { n: 2 }) } } },
    { id: "log", title: "Today", view: { type: "list", entity: "plant", emptyText: ctx => ctx.t({ text: "Water", context: "noun" }) } }],
  reminders: [{ id: "r", entity: "plant", when: () => null, title: (p, ctx) => ctx.t(p.name) }],
});
`;

describe("extractMessages", () => {
  it("finds every slot's words and every ctx.t literal, once each, in source order", async () => {
    const x = (await extractMessages(SOURCE))!;
    expect(x.language).toBe("en");
    expect(x.messages.map((m) => (m.context ? `${m.context}|${m.id}` : m.id))).toEqual([
      "Plants",
      "Plant",
      "Name",
      "Fern",
      "Cactus",
      "Water",
      "Today",
      "Watered {name}",
      "{n, plural, one {# day} other {# days}}",
      "noun|Water",
    ]);
    // "Fern" is a placeholder and an option label; "Today" titles two pages: one message, every place.
    expect(x.messages.find((m) => m.id === "Fern")!.references).toEqual(["entities.plant.fields.name.placeholder", "entities.plant.fields.kind.labels.fern"]);
    expect(x.messages.find((m) => m.id === "Today")!.references).toHaveLength(2);
  });

  it("says which words it cannot take: a computed ctx.t argument", async () => {
    const x = (await extractMessages(SOURCE))!;
    expect(x.problems).toEqual([expect.objectContaining({ why: "not-literal", text: "ctx.t(p.name)" })]);
  });

  it("takes a slot's words from a const marked with msg, and says when a const is not marked", async () => {
    const source = `import { defineApp, msg } from "potyro";
const EMPTY = msg("Nothing here yet");
const PLAIN = "Not marked";
export default defineApp({
  id: "a", name: "A", version: "1.0.0", schemaVersion: 1, language: "en",
  entities: { item: { label: "Item", fields: { name: { type: "text", label: "Name" } } } },
  pages: [{ id: "p", title: "P", view: { type: "list", entity: "item", emptyText: EMPTY } },
    { id: "q", title: "Q", view: { type: "list", entity: "item", emptyText: PLAIN } }],
});
`;
    const x = (await extractMessages(source))!;
    expect(x.messages.map((m) => m.id)).toContain("Nothing here yet");
    expect(x.messages.map((m) => m.id).filter((id) => id.startsWith("__"))).toEqual([]);
    expect(x.problems).toEqual([expect.objectContaining({ why: "behind-code", text: "pages.1.view.emptyText" })]);
  });
});

describe("mergeCatalog", () => {
  const messages = [{ id: "Today", references: ["pages.0.title"] }, { id: "Water now", references: ["pages.0.layout"] }, { id: "Coming up", references: ["x"] }];

  it("starts a language with every message, none translated", () => {
    const { po, report } = mergeCatalog(null, "pl", messages);
    expect(readPo(po).language).toBe("pl");
    expect(readPo(po).entries.map((e) => [e.id, e.text])).toEqual([["Today", ""], ["Water now", ""], ["Coming up", ""]]);
    expect(report).toMatchObject({ added: 3, translated: 0, total: 3 });
  });

  it("keeps translations, lends a near match as fuzzy, and keeps what is gone as obsolete", () => {
    const before = mergeCatalog(null, "pl", [{ id: "Today", references: [] }, { id: "Water now!", references: [] }, { id: "Schedule", references: [] }]).po
      .replace('msgid "Today"\nmsgstr ""', 'msgid "Today"\nmsgstr "Dziś"')
      .replace('msgid "Water now!"\nmsgstr ""', 'msgid "Water now!"\nmsgstr "Podlej teraz!"')
      .replace('msgid "Schedule"\nmsgstr ""', 'msgid "Schedule"\nmsgstr "Harmonogram"');
    const { po, report } = mergeCatalog(before, "pl", messages);
    const entries = readPo(po).entries;
    expect(entries.map((e) => [e.id, e.text, e.fuzzy, e.obsolete])).toEqual([
      ["Today", "Dziś", false, false],
      ["Water now", "Podlej teraz!", true, false],
      ["Coming up", "", false, false],
      ["Water now!", "Podlej teraz!", false, true],
      ["Schedule", "Harmonogram", false, true],
    ]);
    expect(report).toMatchObject({ added: 1, fuzzy: 1, obsolete: 2, translated: 1, total: 3 });
    // Only what is checked reaches the app: the fuzzy one shows in English until then.
    expect(compileCatalog(po)).toEqual({ Today: "Dziś" });
  });

  it("is stable: merging again changes nothing", () => {
    const once = mergeCatalog(null, "pl", messages).po;
    expect(mergeCatalog(once, "pl", messages).po).toBe(once);
  });

  it("measures likeness on words, not case or punctuation", () => {
    expect(likeness("Water now!", "water now")).toBe(1);
    expect(likeness("Water now", "Coming up")).toBeLessThan(0.5);
  });

  it("writes the template with every message empty", () => {
    expect(readPo(writeTemplate(messages)).entries.every((e) => e.text === "")).toBe(true);
  });
});
