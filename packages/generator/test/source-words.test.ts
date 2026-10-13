// Reading an app's words from its source, and splicing a language in (#302, docs/20 §5.1).

import { describe, expect, it } from "vitest";
import { defineApp, localize, wordGaps, type AppInput } from "potyro";
import { describeWordsReport, functionStrings, readSourceWords, sourceSlots, spliceLanguage, wordsReport } from "../src/source-words.js";

const SOURCE = `import { defineApp } from "potyro";

const SIZES = ["s", "m"];

export default defineApp({
  id: "shop", name: "Shopping", version: "1.0.0", schemaVersion: 2,
  language: "en",
  entities: {
    item: {
      label: "Item", // what one thing is called
      fields: {
        name: { type: "text", required: true, placeholder: "Milk" },
        kind: { type: "enum", options: ["produce", "dairy"] },
        size: { type: "enum", options: SIZES },
        note: { type: "text", label: NOTE_LABEL },
      },
      computed: {
        line: (r, ctx) => (r.kind === "dairy" ? \`Keep \${r.name} cold\` : ctx.t({ en: "Fine" })),
      },
    },
  },
  pages: [
    { id: "list", title: "Shopping", view: { type: "list", entity: "item", emptyText: "Nothing on the list." } },
    { id: "named", title: (ctx) => ctx.t({ en: "Named" }), view: { type: "list", entity: "item" } },
  ],
});
`;

describe("the slots in a source", () => {
  it("lists literal words, words behind code, and the slots a translation should add", async () => {
    const sw = (await readSourceWords(SOURCE))!;
    const slots = sourceSlots(sw);
    const at = (p: string) => slots.find((s) => s.path === p);
    expect(at("name")).toEqual({ path: "name", value: "Shopping", kind: "literal" });
    expect(at("entities.item.label")).toMatchObject({ value: "Item", kind: "literal" });
    expect(at("entities.item.fields.note.label")).toMatchObject({ kind: "code" });
    expect(at("entities.item.fields.name.label")).toMatchObject({ suggested: "Name" });
    expect(at("entities.item.fields.kind.labels.dairy")).toMatchObject({ suggested: "dairy" });
    expect(at("pages.1.title")).toBeUndefined(); // a function: its words are in its body
  });

  it("finds the strings inside functions that are not in ctx.t yet", async () => {
    const sw = (await readSourceWords(SOURCE))!;
    expect(functionStrings(sw).map((s) => s.text)).toEqual(["Keep ${r.name} cold"]);
  });
});

describe("splicing a language in", () => {
  it("turns plain strings into maps, adds labels and option labels, declares the language — and nothing else moves", async () => {
    const out = await spliceLanguage(SOURCE, "pl", {
      name: "Zakupy",
      "entities.item.label": "Produkt",
      "entities.item.fields.name.placeholder": "Mleko",
      "entities.item.fields.name.label": "Nazwa",
      "entities.item.fields.kind.labels.produce": "Warzywa",
      "entities.item.fields.kind.labels.dairy": "Nabiał",
      "pages.0.title": "Zakupy",
      "pages.0.view.emptyText": "Lista jest pusta.",
      "entities.item.fields.note.label": "Notatka",
      "pages.9.title": "?",
    });
    expect(out.refused.map((r) => r.path)).toEqual(["entities.item.fields.note.label", "pages.9.title"]);
    expect(out.written).toHaveLength(8);
    expect(out.source).toContain(`name: { en: "Shopping", pl: "Zakupy" }`);
    expect(out.source).toContain(`label: { en: "Item", pl: "Produkt" }, // what one thing is called`);
    expect(out.source).toContain(`labels: { produce: { en: "produce", pl: "Warzywa" }, dairy: { en: "dairy", pl: "Nabiał" } }`);
    expect(out.source).toContain(`language: "en", languages: ["en", "pl"]`);
    // Outside the spliced ranges the file is byte-identical.
    expect(out.source.split("\n").slice(0, 3)).toEqual(SOURCE.split("\n").slice(0, 3));
    expect(out.source).toContain("line: (r, ctx) => (r.kind === \"dairy\" ? `Keep ${r.name} cold` : ctx.t({ en: \"Fine\" })),");

    // The result is a valid app, and in English it reads exactly as before.
    const load = (src: string): AppInput => {
      const body = src.replace(/^import .*$/m, "").replace("export default defineApp(", "return (").replace(/;\s*$/, "");
      return new Function("SIZES", "NOTE_LABEL", `const SIZES_ = SIZES; ${body.replace(/^const SIZES = .*$/m, "")}`)(["s", "m"], "Note") as AppInput;
    };
    const before = defineApp(load(SOURCE));
    const after = defineApp(load(out.source));
    expect(localize(after, "pl").name).toBe("Zakupy");
    expect(JSON.stringify(localize(after, "en").pages)).toBe(JSON.stringify(localize(before, "en").pages));
    expect(wordGaps(after)).toEqual([]);
  });

  it("adds a third language to existing maps, and asks for `from` when the app declares none", async () => {
    const two = (await spliceLanguage(SOURCE, "pl", { name: "Zakupy" })).source;
    const three = await spliceLanguage(two, "de", { name: "Einkäufe" });
    expect(three.source).toContain(`name: { en: "Shopping", pl: "Zakupy", de: "Einkäufe" }`);
    expect(three.source).toContain(`languages: ["en", "pl", "de"]`);
    const bare = SOURCE.replace(`  language: "en",\n`, "");
    expect((await spliceLanguage(bare, "de", { name: "Einkäufe" })).refused[0]!.why).toMatch(/say which one it is written in with `from`/);
    const fromEn = await spliceLanguage(bare, "de", { name: "Einkäufe" }, "en");
    expect(fromEn.source).toContain(`schemaVersion: 2, language: "en", languages: ["en", "de"]`);
  });
});

describe("completeness — what check adds (docs/20 §5.1)", () => {
  it("a candidate that ADDS a gap fails; a gap that was there is only reported; new plain strings are a note", async () => {
    const before = (await spliceLanguage(SOURCE, "pl", { name: "Zakupy", "pages.0.title": "Zakupy" })).source;
    const after = before.replace(`placeholder: "Milk" }`, `placeholder: "Milk", help: { en: "What to buy" } }`).replace(`emptyText: "Nothing on the list."`, `emptyText: "Nothing on the list.", filters: [{ label: "Search", param: "q", type: "text" }]`);
    const report = await wordsReport(before, after);
    expect(report.added).toEqual(["entities.item.fields.name.help has no pl"]);
    expect(report.existing.some((g) => g.startsWith("ctx.t("))).toBe(true); // ctx.t({ en: "Fine" }) was already missing pl
    expect(report.plain).toEqual(['pages.0.view.filters.0.label: "Search"']);
    expect(describeWordsReport(report).fails).toBe(true);
    expect(describeWordsReport(await wordsReport(before, before)).fails).toBe(false);
  });

  it("a one-language app has nothing to report", async () => {
    expect(await wordsReport(SOURCE, SOURCE.replace('"Item"', '"Thing"'))).toEqual({ added: [], existing: [], plain: [] });
  });
});
