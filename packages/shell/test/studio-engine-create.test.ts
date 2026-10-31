// A new app made through the create loop (#262 phase 3): a chat engine with a key goes through the
// loop, and what the loop ends with reaches the Studio as an outcome in plain words. Other engines
// keep the one call.

import { describe, expect, it, vi } from "vitest";
import type { CreateLoopOutcome } from "@potyro/generator/agent";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "../src/engines.js";

const next = vi.hoisted(() => ({ outcome: undefined as unknown, briefs: [] as string[] }));
vi.mock("../src/start-create.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/start-create.js")>()),
  startCreate: async (opts: { brief: string }) => (next.briefs.push(opts.brief), next.outcome),
}));

const { studioEngine } = await import("../src/studio-engine.js");

const openrouter: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "test-key" };
const create = (outcome: CreateLoopOutcome, engine = openrouter) => {
  next.outcome = outcome;
  return studioEngine(engine, () => {}).create("a reading tracker");
};
const JARGON = /NEEDS-PLATFORM|ctx\.|candidate|the model|marker|draft/i;

describe("the Studio's create goes through the loop (#262 phase 3)", () => {
  it("an app that passed: the source, as the conversation lands it", async () => {
    const out = await create({ kind: "source", source: "APP", warnings: [], draft: 2, candidate: 2 });
    expect(out).toEqual({ kind: "source", source: "APP", summary: "" });
    expect(next.briefs.at(-1)).toBe("a reading tracker");
  });

  it("an app that passed carries its sample records: its demo records (#486)", async () => {
    const seed = { book: [{ id: "book-1", title: "Piranesi" }, { id: "book-2", title: "Dune" }] };
    const out = await create({ kind: "source", source: "APP", warnings: [], draft: 1, candidate: 1, seed } as CreateLoopOutcome);
    expect(out).toEqual({ kind: "source", source: "APP", summary: "", seed });
  });

  it("a question before building is the question (#261)", async () => {
    expect(await create({ kind: "question", text: "Paper books, or e-books too?" })).toEqual({ kind: "question", text: "Paper books, or e-books too?" });
  });

  it("nothing could be built: said plainly, with the request (#263)", async () => {
    const request = { title: "Scan barcodes", body: "I wanted to scan a book." };
    const out = await create({ kind: "platform", request, said: "barcodes" });
    expect(out).toMatchObject({ kind: "platform", request });
    expect(out.kind === "platform" && out.text).toMatch(/didn't make the app/);
    expect(out.kind === "platform" && out.text).not.toMatch(JARGON);
  });

  it("a give-up is said in a create's words, the loop's reason folded away", async () => {
    for (const cause of ["candidates", "repeated", "steps"] as const) {
      const out = await create({ kind: "failed", cause, reason: "4 candidates failed the check" });
      expect(out.kind).toBe("failed");
      expect(out.kind === "failed" && out.text).toMatch(/couldn't make this app/);
      expect(out.kind === "failed" && out.text).not.toMatch(JARGON);
      expect(out.kind === "failed" && out.detail).toBe("4 candidates failed the check");
    }
  });

  it("an engine without tool calls never reaches the loop", async () => {
    next.briefs.length = 0;
    const cli: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, engine: "builtin" };
    await studioEngine(cli, () => {}).create("a reading tracker").catch(() => null);
    expect(next.briefs).toHaveLength(0);
  });
});
