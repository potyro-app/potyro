// "Translate this app into German" through the modify loop (#302, docs/20 §5.1): the model asks
// `translate` for the list, answers once with { path: words }, wraps a string in a function with
// SEARCH/REPLACE against the TRANSLATED app, and the result keeps every language in step. Scripted
// engines; nothing here calls a model.

import { describe, expect, it } from "vitest";
import { runModifyLoop, type ModifyLoopDeps } from "../src/agent/modify-loop.js";
import { buildDiscoveryTools } from "../src/agent/discovery-tools.js";
import { createDraft } from "../src/agent/translate-tool.js";
import { runTool } from "../src/agent/tools.js";
import type { ChatEngine, ChatRequest, ChatResponse } from "../src/chat-backend.js";

const SOURCE = `import { defineApp } from "potyro";

export default defineApp({
  id: "shop", name: "Shopping", version: "1.0.0", schemaVersion: 1,
  language: "en",
  entities: {
    item: {
      label: "Item",
      fields: { name: { type: "text", label: "Name" } },
      computed: { line: (r) => \`Buy \${r.name}\` },
    },
  },
  pages: [{ id: "list", title: "Shopping", view: { type: "list", entity: "item" } }],
});
`;

function scripted(turns: ChatResponse["choices"][number]["message"][]): { engine: ChatEngine; seen: ChatRequest[] } {
  const seen: ChatRequest[] = [];
  let i = 0;
  return { seen, engine: { chat: { completions: { create: async (req) => (seen.push({ ...req, messages: [...req.messages] }), { choices: [{ message: turns[i++] ?? { content: "" } }] }) } } } };
}

const call = (id: string, args: unknown) => ({ id, type: "function" as const, function: { name: "translate", arguments: JSON.stringify(args) } });
const edit = (prose: string, search: string, replace: string) => `${prose}\n\`\`\`ts\n<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE\n\`\`\`\n`;

function deps(engine: ChatEngine, check: (s: string) => Promise<string[]> = async () => []): ModifyLoopDeps {
  const draft = createDraft(SOURCE);
  return {
    engine,
    tools: buildDiscoveryTools({ check, source: SOURCE, draft }),
    draft,
    system: "contract",
    instruction: "Translate this app into German",
    source: SOURCE,
    check,
    shapeOf: async () => ({ entities: { item: {} }, pages: [] }),
    before: { entities: { item: {} }, pages: [] },
  };
}

const WORDS = { name: "Einkaufen", "entities.item.label": "Artikel", "entities.item.fields.name.label": "Name", "pages.0.title": "Einkaufen" };

describe("translate", () => {
  it("lists every words slot with its path, and the strings in functions still to wrap", async () => {
    const draft = createDraft(SOURCE);
    const tools = buildDiscoveryTools({ check: async () => [], source: SOURCE, draft });
    const out = await runTool(tools, { id: "1", name: "translate", args: { language: "de" } });
    expect(out.ok).toBe(true);
    expect(out.detail).toContain('- name: "Shopping"');
    expect(out.detail).toContain('- entities.item.fields.name.label: "Name"');
    expect(out.detail).toContain('- pages.0.title: "Shopping"');
    expect(out.detail).toMatch(/Strings inside functions[\s\S]*"Buy \$\{r.name\}"/);
    expect(draft.source).toBe(SOURCE); // listing writes nothing
  });

  it("splices the words in, and the loop's edits then apply to the translated app", async () => {
    const { engine, seen } = scripted([
      { content: "", tool_calls: [call("t1", { language: "de" })] },
      { content: "", tool_calls: [call("t2", { language: "de", words: WORDS })] },
      { content: edit("Wrapped the line in ctx.t.", "      computed: { line: (r) => `Buy ${r.name}` },", '      computed: { line: (r, ctx) => ctx.t({ en: "Buy {name}", de: "{name} kaufen" }, { name: r.name }) },') },
    ]);
    const out = await runModifyLoop(deps(engine));
    expect(out.kind).toBe("source");
    const src = out.kind === "source" ? out.source : "";
    expect(src).toContain(`name: { en: "Shopping", de: "Einkaufen" }`);
    expect(src).toContain(`label: { en: "Item", de: "Artikel" }`);
    expect(src).toContain(`languages: ["en", "de"]`);
    expect(src).toContain(`ctx.t({ en: "Buy {name}", de: "{name} kaufen" }`);
    expect(src).toContain("schemaVersion: 1"); // a translation is not a data change
    const answer = seen[2]!.messages.at(-1)!.content;
    expect(answer).toMatch(/Wrote 4 words in de/);
    expect(answer).toMatch(/now the translated one/);
  });

  it("a reply with no edits after the translation sends the translation as it is", async () => {
    const { engine } = scripted([{ content: "", tool_calls: [call("t1", { language: "de", words: WORDS })] }, { content: "Done: the app reads in German." }]);
    const out = await runModifyLoop(deps(engine));
    expect(out).toMatchObject({ kind: "source", via: "edits", rationale: "Done: the app reads in German." });
    expect(out.kind === "source" && out.source).toContain(`de: "Artikel"`);
  });

  it("a candidate that adds a gap in a translated app is sent back with what is missing", async () => {
    const { engine, seen } = scripted([
      { content: "", tool_calls: [call("t1", { language: "de", words: WORDS })] },
      { content: edit("Added help.", '      fields: { name: { type: "text", label: { en: "Name", de: "Name" } } },', '      fields: { name: { type: "text", label: { en: "Name", de: "Name" }, help: { en: "What to buy" } } },') },
      { content: edit("Added help in both.", '      fields: { name: { type: "text", label: { en: "Name", de: "Name" } } },', '      fields: { name: { type: "text", label: { en: "Name", de: "Name" }, help: { en: "What to buy", de: "Was kaufen" } } },') },
    ]);
    const out = await runModifyLoop(deps(engine));
    expect(out.kind).toBe("source");
    expect(seen[2]!.messages.at(-1)!.content).toMatch(/entities\.item\.fields\.name\.help has no de/);
  });

  it("a translation that does not validate is not kept", async () => {
    const draft = createDraft(SOURCE);
    const tools = buildDiscoveryTools({ check: async () => ["boom"], source: SOURCE, draft });
    const out = await runTool(tools, { id: "1", name: "translate", args: { language: "de", words: WORDS } });
    expect(out).toMatchObject({ ok: false });
    expect(out.detail).toMatch(/fails validation, so it was not kept/);
    expect(draft.source).toBe(SOURCE);
  });
});
