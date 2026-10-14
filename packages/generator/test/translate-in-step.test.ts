// Found by the paid eval:translate run (#302): adding German to groceries (already en+pl) opened gaps
// in Polish, so every candidate failed the check and the loop gave up; and renaming a label in
// English left Polish saying the old thing, with nothing to catch it.

import { describe, expect, it } from "vitest";
import { describeWordsReport, readSourceWords, sourceSlots, spliceLanguage, wordsReport } from "../src/source-words.js";
import { runModifyLoop, type ModifyLoopDeps } from "../src/agent/modify-loop.js";
import type { ChatEngine, ChatRequest, ChatResponse } from "../src/chat-backend.js";

const TWO = `import { defineApp } from "potyro";

export default defineApp({
  id: "shop", name: { en: "Shopping", pl: "Zakupy" }, version: "1.0.0", schemaVersion: 1,
  language: "en", languages: ["en", "pl"],
  entities: {
    item: {
      label: { en: "Item", pl: "Produkt" },
      fields: {
        name: { type: "text", placeholder: "Milk" },
        position: { type: "number", hidden: true },
      },
    },
  },
  pages: [{ id: "list", title: { en: "Shopping", pl: "Zakupy" }, view: { type: "list", entity: "item" } }],
});
`;

describe("a third language in an app that already has two", () => {
  it("a plain string keeps its words in the languages the app already carries", async () => {
    const out = await spliceLanguage(TWO, "de", { "entities.item.fields.name.placeholder": "Milch" });
    expect(out.source).toContain(`placeholder: { en: "Milk", pl: "Milk", de: "Milch" }`);
    expect((await wordsReport(TWO, out.source)).added.filter((g) => /\bpl\b/.test(g))).toEqual([]); // de is half done here; pl lost nothing
  });

  it("a slot with no words yet needs every carried language: a string is refused, an object written", async () => {
    const refused = await spliceLanguage(TWO, "de", { "entities.item.fields.name.label": "Name" });
    expect(refused.refused[0]!.why).toMatch(/no words yet in pl either — give \{ pl: "…", de: "…" \}/);
    const ok = await spliceLanguage(TWO, "de", { "entities.item.fields.name.label": { pl: "Nazwa", de: "Name" } });
    expect(ok.source).toContain(`label: { en: "Name", pl: "Nazwa", de: "Name" }`);
    expect((await wordsReport(TWO, ok.source)).added.filter((g) => /\bpl\b/.test(g))).toEqual([]);
  });

  it("a hidden field's label is not asked for", async () => {
    const sw = (await readSourceWords(TWO))!;
    expect(sourceSlots(sw).map((s) => s.path)).not.toContain("entities.item.fields.position.label");
  });
});

describe("languages kept in step on an ordinary edit", () => {
  const one = TWO.replace(`label: { en: "Item", pl: "Produkt" }`, `label: { en: "Thing", pl: "Produkt" }`);
  const both = TWO.replace(`label: { en: "Item", pl: "Produkt" }`, `label: { en: "Thing", pl: "Rzecz" }`);

  it("a map renamed in its own language only is reported stale; renamed in all, it is not", async () => {
    const report = await wordsReport(TWO, one);
    expect(report.stale).toEqual(['entities.item.label: en is now "Thing", but pl still says "Produkt"']);
    expect(describeWordsReport(report)).toMatchObject({ fails: false, warns: true });
    expect((await wordsReport(TWO, both)).stale).toEqual([]);
  });

  function scripted(turns: string[]): { engine: ChatEngine; seen: ChatRequest[] } {
    const seen: ChatRequest[] = [];
    let i = 0;
    const engine: ChatEngine = { chat: { completions: { create: async (req): Promise<ChatResponse> => (seen.push({ ...req, messages: [...req.messages] }), { choices: [{ message: { content: turns[i++] ?? "" } }] }) } } };
    return { engine, seen };
  }
  const edit = (to: string) => `Renamed.\n\`\`\`ts\n<<<<<<< SEARCH\n      label: { en: "Item", pl: "Produkt" },\n=======\n      label: ${to},\n>>>>>>> REPLACE\n\`\`\`\n`;
  const deps = (engine: ChatEngine): ModifyLoopDeps => ({
    engine,
    tools: [],
    system: "contract",
    instruction: "Rename Item to Thing",
    source: TWO,
    check: async () => [],
    shapeOf: async () => ({ entities: { item: {} }, pages: [] }),
    before: { entities: { item: {} }, pages: [] },
  });

  it("the loop points a one-language rename out once, and takes the fixed one", async () => {
    const { engine, seen } = scripted([edit(`{ en: "Thing", pl: "Produkt" }`), edit(`{ en: "Thing", pl: "Rzecz" }`)]);
    const out = await runModifyLoop(deps(engine));
    expect(out.kind === "source" && out.source).toContain(`{ en: "Thing", pl: "Rzecz" }`);
    expect(seen[1]!.messages.at(-1)!.content).toMatch(/pl still says "Produkt"/);
  });

  it("the same one-language rename sent again is meant, and accepted", async () => {
    const same = edit(`{ en: "Thing", pl: "Produkt" }`);
    const { engine } = scripted([same, same]);
    const out = await runModifyLoop(deps(engine));
    expect(out.kind === "source" && out.source).toContain(`{ en: "Thing", pl: "Produkt" }`);
  });
});
