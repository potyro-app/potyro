import { describe, expect, it } from "vitest";
import { runCreateLoop, type CreateLoopDeps } from "../src/agent/create-loop.js";
import { buildCreateTools } from "../src/agent/discovery-tools.js";
import type { AgentTool } from "../src/agent/tools.js";
import type { LoopStep } from "../src/agent/loop.js";
import type { ChatEngine, ChatRequest, ChatResponse } from "../src/chat-backend.js";
import { buildCorpus } from "../src/corpus.js";
import type { RunReport } from "../src/run-report.js";

// The create loop (#262 phase 3): a new app on the modify loop's footing — corpus in the first
// message, tools, a gate every candidate must pass, independent first drafts (docs/19 §4 item 7), and
// the question, platform and language paths of the single-shot create. Engines are scripted.

const app = (name: string, extra = "") => `import { defineApp } from "potyro";\nexport default defineApp({ id: "x", name: "${name}"${extra} });`;
const fenced = (src: string, prose = "") => `${prose}${prose ? "\n" : ""}\`\`\`ts\n${src}\n\`\`\``;
type Turn = ChatResponse["choices"][number]["message"];

function scripted(turns: Turn[]): { engine: ChatEngine; seen: ChatRequest[] } {
  const seen: ChatRequest[] = [];
  let i = 0;
  return {
    seen,
    engine: { chat: { completions: { create: async (req) => (seen.push({ ...req, messages: [...req.messages] }), { choices: [{ message: turns[i++] ?? { content: "" } }] }) } } },
  };
}

const lookup: AgentTool = {
  name: "lookup",
  description: "look",
  parameters: { type: "object", properties: { query: { type: "string" } } },
  run: async (a) => ({ ok: true, detail: a.query === "barcodeScanner" ? 'Nothing in the potyro module is called "barcodeScanner" or declares a "barcodeScanner". It does not exist.' : `declaration of ${String(a.query)}` }),
};
const call = (name: string, args: Record<string, unknown>, id = "t1"): Turn => ({ content: "", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });

/** BROKEN validates with one issue per mark, NOCOMPILE throws, THROWS breaks when it runs, EMPTY shows nothing. */
const check = async (src: string): Promise<string[]> => {
  if (src.includes("NOCOMPILE")) throw new Error("Unexpected token");
  return [...src.matchAll(/BROKEN/g)].map((_, i) => `pages[${i}].view.entity: no such entity`);
};
const run = async (src: string): Promise<RunReport> => ({
  errors: src.includes("THROWS") ? ["computed total: ctx.nope is not a function"] : [],
  warnings: src.includes("EMPTY") ? ['page "done" showed none of the sample records — a filter that can never match?'] : [],
  ran: "1 page",
});

const base = (over: Partial<CreateLoopDeps>): CreateLoopDeps => ({ engine: scripted([]).engine, tools: [lookup], system: "contract", brief: "a reading tracker", check, run, ...over });

describe("runCreateLoop", () => {
  it("keeps a first draft that passes, with ONE model call: the second draft is made only when the first fails", async () => {
    const { engine, seen } = scripted([{ content: fenced(app("Reader")) }]);
    const out = await runCreateLoop(base({ engine }));
    expect(out).toMatchObject({ kind: "source", draft: 1, candidate: 1, warnings: [] });
    expect(out.kind === "source" && out.source).toContain('name: "Reader"');
    expect(seen).toHaveLength(1);
    // The create turn, with the tools offered, at the single-shot create's temperature.
    expect(seen[0]!.messages[1]!.content).toContain('Create a Potyro app for this request:\n\n"a reading tracker"');
    expect(seen[0]!.tools?.map((t) => t.function.name)).toEqual(["lookup"]);
    expect(seen[0]!.temperature).toBe(0.2);
  });

  it("makes a second, INDEPENDENT draft when the first fails the gate, and keeps the one that passes", async () => {
    const { engine, seen } = scripted([{ content: fenced(app("One BROKEN")) }, { content: fenced(app("Two")) }]);
    const steps: LoopStep[] = [];
    const out = await runCreateLoop(base({ engine, onStep: (s) => steps.push(s) }));
    expect(out).toMatchObject({ kind: "source", draft: 2, candidate: 2 });
    expect(seen).toHaveLength(2);
    // The second draft never saw the first: the same opening, and nothing after it.
    expect(seen[1]!.messages).toHaveLength(2);
    expect(seen[1]!.messages[1]!.content).toBe(seen[0]!.messages[1]!.content);
    expect(JSON.stringify(seen[1]!.messages)).not.toContain("One BROKEN");
    expect(seen[1]!.temperature).toBeGreaterThan(seen[0]!.temperature!);
    expect(steps.filter((s) => s.kind === "candidate").map((s) => s.kind === "candidate" && [s.n, s.draft, s.passed])).toEqual([
      [1, 1, false],
      [2, 2, true],
    ]);
  });

  it("with drafts: 1, repairs the one draft with the validator's words instead", async () => {
    const { engine, seen } = scripted([{ content: fenced(app("One BROKEN")) }, { content: fenced(app("One fixed")) }]);
    const out = await runCreateLoop(base({ engine, drafts: 1 }));
    expect(out).toMatchObject({ kind: "source", draft: 1, candidate: 2 });
    const feedback = seen[1]!.messages.at(-1)!;
    expect(feedback.role).toBe("user");
    expect(feedback.content).toContain("pages[0].view.entity: no such entity");
    expect(seen[1]!.messages.at(-2)!.content).toContain("One BROKEN");
  });

  it("when both drafts fail, repairs the one with fewer problems — in its own conversation", async () => {
    const { engine, seen } = scripted([
      { content: fenced(app("One NOCOMPILE")) },
      { content: fenced(app("Two BROKEN")) },
      { content: fenced(app("Two fixed")) },
    ]);
    const out = await runCreateLoop(base({ engine }));
    expect(out).toMatchObject({ kind: "source", draft: 2, candidate: 3 });
    const repair = JSON.stringify(seen[2]!.messages);
    expect(repair).toContain("Two BROKEN");
    expect(repair).not.toContain("One NOCOMPILE");
    expect(seen[2]!.temperature).toBe(0.1);
  });

  it("a repair may send edits against the version it last sent in full", async () => {
    const edits = `Fixing the page.\n\`\`\`ts\n<<<<<<< SEARCH\n${app("One BROKEN").split("\n")[1]}\n=======\n${app("One").split("\n")[1]}\n>>>>>>> REPLACE\n\`\`\``;
    const { engine } = scripted([{ content: fenced(app("One BROKEN")) }, { content: edits }]);
    const out = await runCreateLoop(base({ engine, drafts: 1 }));
    expect(out).toMatchObject({ kind: "source", candidate: 2, rationale: "Fixing the page." });
    expect(out.kind === "source" && out.source).toBe(app("One"));
  });

  it("a run that throws holds the app back; a page that shows nothing on a fresh app does not", async () => {
    const thrown = scripted([{ content: fenced(app("THROWS")) }, { content: fenced(app("Fine")) }]);
    const out = await runCreateLoop(base({ engine: thrown.engine }));
    expect(out).toMatchObject({ kind: "source", draft: 2 });

    const empty = scripted([{ content: fenced(app("EMPTY")) }, { content: fenced(app("never asked for")) }]);
    const kept = await runCreateLoop(base({ engine: empty.engine }));
    expect(kept).toMatchObject({ kind: "source", draft: 1, candidate: 1 });
    expect(kept.kind === "source" && kept.warnings[0]).toMatch(/showed none of the sample records/);
    expect(empty.seen).toHaveLength(1);
  });

  it("the first message carries the language line and the corpus passages that speak to the request", async () => {
    const corpus = buildCorpus([{ path: "apps/books/books.app.ts", text: "// a reading tracker of books, with a rating\nexport default defineApp({ id: \"books\" });" }]);
    const { engine, seen } = scripted([{ content: fenced(app("Czytelnik")) }]);
    await runCreateLoop(base({ engine, language: "pl", corpus: async () => corpus, brief: "a reading tracker for books" }));
    const first = seen[0]!.messages[1]!.content;
    expect(first).toMatch(/the person speaks Polish/);
    expect(first).toContain("apps/books/books.app.ts");
  });

  it("a corpus that cannot be loaded leaves the create as it was", async () => {
    const { engine } = scripted([{ content: fenced(app("Reader")) }]);
    const out = await runCreateLoop(base({ engine, corpus: async () => Promise.reject(new Error("offline")) }));
    expect(out.kind).toBe("source");
  });

  it("a question before building ends the loop, with no second draft (#261); ASK: reads the same", async () => {
    const { engine, seen } = scripted([{ content: "QUESTION: Do you want to rate the books?" }]);
    expect(await runCreateLoop(base({ engine }))).toEqual({ kind: "question", text: "Do you want to rate the books?" });
    expect(seen).toHaveLength(1);
    const asked = scripted([{ content: "ASK: Paper books, or e-books too?" }]);
    expect(await runCreateLoop(base({ engine: asked.engine }))).toEqual({ kind: "question", text: "Paper books, or e-books too?" });
  });

  it("NEEDS-PLATFORM is sent to the tools once, then written up with the tools off (#263)", async () => {
    const { engine, seen } = scripted([
      { content: "NEEDS-PLATFORM: reading barcodes" },
      call("lookup", { query: "barcodeScanner" }),
      { content: "NEEDS-PLATFORM: reading barcodes with the camera" },
      { content: "TITLE: Scan barcodes\nI wanted to scan a book's barcode." },
    ]);
    const out = await runCreateLoop(base({ engine }));
    expect(out).toMatchObject({ kind: "platform", said: "reading barcodes with the camera", request: { title: "Scan barcodes" } });
    expect(seen[1]!.messages.at(-1)!.content).toMatch(/lookup/);
    expect(seen.at(-1)!.tool_choice).toBe("none");
  });

  it("an app built beside a NEEDS-PLATFORM line comes back with the request", async () => {
    const { engine } = scripted([
      call("lookup", { query: "barcodeScanner" }),
      { content: fenced(app("Reader"), "NEEDS-PLATFORM: reading barcodes") },
      { content: "TITLE: Scan barcodes\nTo fill a book in from its barcode." },
    ]);
    const out = await runCreateLoop(base({ engine }));
    expect(out).toMatchObject({ kind: "source", platformRequest: { title: "Scan barcodes" } });
  });

  it("a lookup that names something Potyro lacks carries the offer", async () => {
    const { engine, seen } = scripted([call("lookup", { query: "barcodeScanner" }), { content: fenced(app("Reader")) }]);
    await runCreateLoop(base({ engine }));
    expect(seen[1]!.messages.at(-1)!.content).toContain("NEEDS-PLATFORM:");
  });

  it("a repair repeated word for word is rolled back once; the second time it gives up, the best candidate attached", async () => {
    const same = { content: "I would add a page for the books." };
    const { engine, seen } = scripted([{ content: fenced(app("One BROKEN")) }, same, same, same]);
    const steps: LoopStep[] = [];
    const out = await runCreateLoop(base({ engine, drafts: 1, onStep: (s) => steps.push(s) }));
    expect(out).toMatchObject({ kind: "failed", cause: "repeated", best: app("One BROKEN") });
    expect(steps.filter((s) => s.kind === "unusable" && s.repeat)).toHaveLength(2);
    // The repeat came out of the conversation — the reply and what answered it — and one note went in its place.
    const after = seen[3]!.messages;
    expect(after.at(-1)!.content).toMatch(/You already did this/);
    expect(after.filter((m) => m.role === "assistant" && m.content.includes("I would add a page"))).toHaveLength(0);
    expect(after.filter((m) => m.content.includes("One BROKEN"))).toHaveLength(1);
  });

  it("an app that was already turned back, sent again in a fresh chain, is a repeat", async () => {
    const again = { content: fenced(app("One BROKEN")) };
    const { engine, seen } = scripted([again, { content: fenced(app("Two BROKEN")) }, again, again]);
    const out = await runCreateLoop(base({ engine, drafts: 1, maxCandidates: 6 }));
    expect(out).toMatchObject({ kind: "failed", cause: "repeated" });
    // The fresh chain (two turned back) carried the note of both; the resend got the rollback note.
    expect(seen[2]!.messages[1]!.content).toMatch(/Already tried and turned back/);
    expect(seen[3]!.messages.at(-1)!.content).toMatch(/You already did this/);
  });

  it("a chain with two candidates turned back starts again from the request; that turn thinks hard when escalating", async () => {
    const { engine, seen } = scripted([
      { content: fenced(app("A BROKEN")) },
      { content: fenced(app("B BROKEN")) },
      { content: fenced(app("C BROKEN")) },
      { content: fenced(app("D")) },
    ]);
    const out = await runCreateLoop(base({ engine, drafts: 2, maxCandidates: 5, escalate: true }));
    expect(out).toMatchObject({ kind: "source", candidate: 4 });
    const fresh = seen[3]!;
    expect(fresh.messages).toHaveLength(2);
    expect(fresh.messages[1]!.content).toMatch(/Already tried and turned back/);
    expect(fresh.reasoning).toBe("high");
    expect(seen[2]!.reasoning).toBeUndefined();
  });

  it("gives up when the candidate budget is spent, keeping the best for the eval", async () => {
    const { engine } = scripted([
      { content: fenced(app("A NOCOMPILE")) },
      { content: fenced(app("B BROKEN BROKEN")) },
      { content: fenced(app("C BROKEN")) },
      { content: fenced(app("D BROKEN BROKEN BROKEN")) },
    ]);
    const out = await runCreateLoop(base({ engine }));
    expect(out).toMatchObject({ kind: "failed", cause: "candidates", best: app("C BROKEN") });
  });

  it("a draft that only calls tools is cut at its step budget and the next draft is made", async () => {
    const { engine, seen } = scripted([
      call("lookup", { query: "a" }, "1"),
      call("lookup", { query: "b" }, "2"),
      { content: fenced(app("Two")) },
    ]);
    const out = await runCreateLoop(base({ engine, draftSteps: 2 }));
    expect(out).toMatchObject({ kind: "source", draft: 2 });
    expect(seen[2]!.messages).toHaveLength(2);
  });

  it("a reply that is prose is sent back once as not an app", async () => {
    const { engine, seen } = scripted([{ content: "Here is how I would build it." }, { content: fenced(app("Reader")) }]);
    const out = await runCreateLoop(base({ engine, drafts: 1 }));
    expect(out).toMatchObject({ kind: "source", candidate: 1 });
    expect(seen[1]!.messages.at(-1)!.content).toMatch(/That was not an app/);
  });

  it("stops between steps when asked to", async () => {
    const stop = new AbortController();
    const engine: ChatEngine = { chat: { completions: { create: async () => (stop.abort(), { choices: [{ message: call("lookup", { query: "x" }) }] }) } } };
    expect(await runCreateLoop(base({ engine, signal: stop.signal }))).toEqual({ kind: "stopped" });
  });
});

describe("CREATE_AGENT_SYSTEM_PROMPT", () => {
  it("is the generator's contract, question rule included, plus the tools and the platform way out", async () => {
    const { CREATE_AGENT_SYSTEM_PROMPT } = await import("../src/agent/create-system-prompt.js");
    const { SYSTEM_PROMPT } = await import("../src/prompt.js");
    expect(CREATE_AGENT_SYSTEM_PROMPT.startsWith(SYSTEM_PROMPT)).toBe(true);
    expect(CREATE_AGENT_SYSTEM_PROMPT).toMatch(/QUESTION: /);
    for (const tool of ["lookup", "check", "example", "search_corpus", "read"]) expect(CREATE_AGENT_SYSTEM_PROMPT).toContain(`\`${tool}\``);
    expect(CREATE_AGENT_SYSTEM_PROMPT).toContain("NEEDS-PLATFORM:");
  });
});

describe("buildCreateTools", () => {
  const tool = (name: string) => buildCreateTools({ check, run, corpus: async () => buildCorpus([]) }).find((t) => t.name === name)!;

  it("offers lookup, check and the corpus tools", () => {
    expect(buildCreateTools({ check }).map((t) => t.name)).toEqual(["lookup", "check", "example", "search_corpus", "read"]);
  });

  it("checks a WHOLE app: validated, then run", async () => {
    expect(await tool("check").run({ source: app("Fine") })).toEqual({ ok: true, detail: expect.stringMatching(/compiles and validates\. Ran it on sample records/) });
    expect(await tool("check").run({ source: fenced(app("BROKEN")) })).toMatchObject({ ok: false, detail: expect.stringMatching(/no such entity/) });
    expect(await tool("check").run({ source: app("NOCOMPILE") })).toMatchObject({ ok: false, detail: expect.stringMatching(/does not compile/) });
    expect(await tool("check").run({ source: app("THROWS") })).toMatchObject({ ok: false, detail: expect.stringMatching(/ctx\.nope/) });
    expect(await tool("check").run({ source: "a list of books" })).toMatchObject({ ok: false, detail: expect.stringMatching(/not an app/) });
  });
});
