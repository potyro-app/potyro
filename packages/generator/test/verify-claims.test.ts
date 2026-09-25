import { describe, expect, it } from "vitest";
import type { AppDefinition } from "karta";
import { Retrieved, type Trust } from "../src/agent/evidence.js";
import { verifyClaims } from "../src/agent/verify-claims.js";
import type { ChatEngine, ChatRequest } from "../src/chat-backend.js";

// The second check (#213): a model reads ONLY the retrieved text and the proposed records, and says
// per record whether its claims are supported, missing from the text, or contradicted by it — the
// case the mechanical check cannot see: the page says "a bar in Pianfei", the record says
// "a vegetarian restaurant in Cuneo".

const DEF = {
  id: "p",
  name: "P",
  entities: { place: { displayField: "name", fields: { name: { type: "text" }, kind: { type: "enum", options: ["bar", "restaurant"] }, notes: { type: "text" }, where: { type: "geo" } } } },
  pages: [],
} as unknown as AppDefinition;

const retrieved = new Retrieved();
retrieved.add("https://a.example/alter-ego", "Alter Ego — bar and pizzeria in Pianfei (CN). Aperitivo, pizza, burgers.");
retrieved.add("https://b.example/bibe", "Bar Bibe, Corso Galileo Ferraris 26, Cuneo. Vegan cuisine, lunches Tuesday to Friday.");

const rows = [
  { entity: "place", ref: "a", values: { name: "Alter Ego", kind: "restaurant", notes: "Vegetarian restaurant in Cuneo", where: { lat: 44.38, lng: 7.54, label: "Cuneo" } } },
  { entity: "place", ref: "b", values: { name: "Bar Bibe", kind: "bar", notes: "Vegan lunches, open Sundays", where: { lat: 44.386, lng: 7.551, label: "Corso Galileo Ferraris 26, Cuneo" } } },
  { entity: "place", ref: "c", values: { name: "Carbonara" }, general: true },
];
const trust: Record<string, Trust> = {
  a: { status: "single", sources: [{ url: "https://a.example/alter-ego", host: "a.example", quote: "Alter Ego — bar and pizzeria in Pianfei" }], issues: [] },
  b: { status: "single", sources: [{ url: "https://b.example/bibe", host: "b.example", quote: "Bar Bibe, Corso Galileo Ferraris 26, Cuneo" }], issues: [] },
  c: { status: "general", sources: [], issues: [] },
};

function engineAnswering(verdicts: unknown): { engine: ChatEngine; seen: ChatRequest[] } {
  const seen: ChatRequest[] = [];
  return {
    seen,
    engine: {
      chat: {
        completions: {
          create: async (req) => (
            seen.push(req),
            { choices: [{ message: { content: "", tool_calls: [{ id: "v", type: "function", function: { name: "verdicts", arguments: JSON.stringify({ verdicts }) } }] } }] }
          ),
        },
      },
    },
  };
}

describe("verifyClaims", () => {
  it("shows the checker only the records with sources, and only their pages' text", async () => {
    const { engine, seen } = engineAnswering([]);
    await verifyClaims({ engine, definition: DEF, rows, trust, retrieved });
    const sent = JSON.stringify(seen[0]!.messages);
    expect(sent).toContain("Pianfei");
    expect(sent).toContain("Corso Galileo Ferraris 26");
    expect(sent).not.toContain("Carbonara");
    expect(sent).not.toContain("44.38"); // coordinates are not a claim to check
  });

  it("judges details field by field, disputed or unstated; the record's status changes only for what identifies it", async () => {
    const { engine } = engineAnswering([
      {
        ref: "a",
        verdict: "contradicted",
        problems: [
          { field: "name", kind: "contradicted", why: "The page is about a bar and pizzeria in Pianfei." },
          { field: "notes", kind: "contradicted", why: "Not a vegetarian restaurant in Cuneo." },
        ],
      },
      { ref: "b", verdict: "unsupported", problems: [{ field: "notes", kind: "unsupported", why: "Nothing says it opens on Sundays." }] },
    ]);
    const out = await verifyClaims({ engine, definition: DEF, rows, trust, retrieved });
    expect(out.a).toMatchObject({ status: "contradicted", fieldIssues: { notes: { kind: "contradicted", why: expect.stringMatching(/vegetarian/) } } });
    expect(out.b).toMatchObject({ status: "single", fieldIssues: { notes: { kind: "unsupported", why: expect.stringMatching(/Sundays/) } } });
    expect(out.c).toEqual(trust.c);
  });

  it("keeps the mechanical verdict, noted, when the check itself fails", async () => {
    const failing: ChatEngine = { chat: { completions: { create: async () => { throw new Error("upstream 502"); } } } };
    const out = await verifyClaims({ engine: failing, definition: DEF, rows, trust, retrieved });
    expect(out.a!.status).toBe("single");
    expect(out.a!.issues.join()).toMatch(/could not be double-checked/i);
  });
});

describe("when the thing itself is not in the sources", () => {
  it("the record is unsupported, not partly confirmed", async () => {
    const { engine } = engineAnswering([{ ref: "b", verdict: "unsupported", problems: [{ field: "name", kind: "unsupported", why: "No text mentions this event on that date." }] }]);
    const out = await verifyClaims({ engine, definition: DEF, rows, trust, retrieved });
    expect(out.b!.status).toBe("unsupported");
  });
});
