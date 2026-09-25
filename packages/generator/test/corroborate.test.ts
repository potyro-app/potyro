import { describe, expect, it } from "vitest";
import type { AppDefinition } from "karta";
import { Retrieved, verifyRow } from "../src/agent/evidence.js";
import { corroborate } from "../src/agent/corroborate.js";
import type { ChatEngine, ChatRequest } from "../src/chat-backend.js";

// One source is weak evidence (#213): each single-source record gets a dedicated search, and its
// sources are counted again. A real thing turns up on another site; a stale listing does not.

const DEF = { id: "p", name: "P", entities: { place: { displayField: "name", fields: { name: { type: "text" }, town: { type: "text" } } } }, pages: [] } as unknown as AppDefinition;

describe("corroborate", () => {
  it("searches for single-source records by name and details, and recounts their sites", async () => {
    const retrieved = new Retrieved();
    retrieved.add("https://one.example/sandia", "Sandía Bistrot, Corso Garibaldi 4, Cuneo.");
    retrieved.add("https://dir.example/alter-ego", "Alter ego, menù vegano, Cuneo.");
    const rows = [
      { entity: "place", ref: "s", values: { name: "Sandía Bistrot", town: "Cuneo" } },
      { entity: "place", ref: "a", values: { name: "Alter ego", town: "Cuneo" } },
    ];
    const trust = { s: verifyRow(DEF, rows[0]!, retrieved), a: verifyRow(DEF, rows[1]!, retrieved) };
    expect([trust.s.status, trust.a.status]).toEqual(["single", "single"]);

    const seen: ChatRequest[] = [];
    const engine: ChatEngine = {
      chat: {
        completions: {
          create: async (req) => (
            seen.push(req),
            { choices: [{ message: { content: "done", citations: [{ url: "https://happycow.net/sandia", content: "Sandía Bistrot in Cuneo: vegan bowls." }] } }] }
          ),
        },
      },
    };
    const out = await corroborate({ engine, definition: DEF, rows, trust, retrieved });
    expect(out.s!.status).toBe("corroborated");
    expect(out.a!.status).toBe("single");
    expect(JSON.stringify(seen[0]!.messages)).toContain("Alter ego (Cuneo)");
    expect(seen[0]!.serverTools).toEqual([{ type: "openrouter:web_search", parameters: { max_results: 5, max_uses: 2 } }]);
  });
});
