// When the change needs something Potyro itself lacks (#263): the loop's request reaches the
// Studio's outcome, in the person's words, whether nothing could be done, part of it was, or it gave up.

import { describe, expect, it, vi } from "vitest";
import type { ModifyLoopOutcome } from "@potyro/generator/agent";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "../src/engines.js";

const next = vi.hoisted(() => ({ outcome: undefined as unknown }));
vi.mock("../src/start-modify.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/start-modify.js")>()),
  startModify: async () => next.outcome,
}));

const { studioEngine } = await import("../src/studio-engine.js");

const engine: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "test-key" };
const request = { title: "Scan barcodes", body: "I wanted to scan the barcode on a pot." };
const modify = (outcome: ModifyLoopOutcome) => {
  next.outcome = outcome;
  return studioEngine(engine, () => {}).modify("SOURCE", { pages: [], entities: {} }, "scan the barcode");
};
const JARGON = /NEEDS-PLATFORM|ctx\.|candidate|the model|marker/i;

describe("a request to the Potyro team reaches the Studio (#263)", () => {
  it("nothing could be done: said plainly, with the request", async () => {
    const out = await modify({ kind: "platform", request, said: "ctx.caps.barcode" });
    expect(out).toMatchObject({ kind: "platform", request });
    expect(out.kind === "platform" && out.text).toMatch(/Potyro can't do yet/);
    expect(out.kind === "platform" && out.text).not.toMatch(JARGON);
  });

  it("part of it was done: the change, with the request beside it", async () => {
    const out = await modify({ kind: "source", source: "NEW", via: "edits", applied: 1, notDone: ["scanning"], platformRequest: request });
    expect(out).toMatchObject({ kind: "source", source: "NEW", platformRequest: request });
  });

  it("it gave up: the plain give-up, with the request", async () => {
    const out = await modify({ kind: "failed", cause: "candidates", reason: "4 candidates failed", platformRequest: request });
    expect(out).toMatchObject({ kind: "failed", platformRequest: request });
  });
});
