// What the Studio's card says when a change could not be made — at the boundary where the modify
// loop's outcome becomes the conversation's words (studio-engine.ts → studio.tsx `say`).
//
// The owner saw "Not changed — the model repeated itself (the reply repeats the previous one word for
// word; 3 candidates failed the check, 0 replies were not a change)" on the card. The people who use
// the Studio do not write code; every way the loop gives up now reads in plain words, and the loop's
// own words are kept as the folded-away detail.

import { describe, expect, it, vi } from "vitest";
import type { ModifyLoopOutcome } from "@potyro/generator/agent";
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from "../src/engines.js";

// A plain function, not a spy: a spy keeps what its call threw, and vitest reports that as an error.
const next = vi.hoisted(() => ({ outcome: undefined as unknown }));
vi.mock("../src/start-modify.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/start-modify.js")>()),
  startModify: async () => {
    if (next.outcome instanceof Error) throw next.outcome;
    return next.outcome;
  },
}));

const { studioEngine } = await import("../src/studio-engine.js");

const engine: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, engine: "openrouter", openrouterKey: "test-key" };
const before = { pages: [], entities: {} };
/** Words a person who does not code should never have to read on the card. */
const JARGON = /candidate|the model|\d+ steps|repl(y|ies)|budget|compile|validat|isolate|sealed box|word for word/i;

const modify = (outcome: ModifyLoopOutcome | Error) => {
  next.outcome = outcome;
  return studioEngine(engine, () => {}).modify("SOURCE", before, "make it blue");
};

describe("the card when a change could not be made", () => {
  const giveUps: Array<[string, Extract<ModifyLoopOutcome, { kind: "failed" }>, RegExp]> = [
    [
      "the model repeated itself",
      { kind: "failed", cause: "repeated", reason: "the model repeated itself (the reply repeats the previous one word for word; 3 candidates failed the check, 0 replies were not a change)" },
      /^I couldn't make this change: I kept coming back to the same answer/,
    ],
    ["the candidates ran out", { kind: "failed", cause: "candidates", reason: "4 candidates failed the check — the candidate budget is spent" }, /^I couldn't make this change: every version I tried failed the app's own checks/],
    ["the steps ran out", { kind: "failed", cause: "steps", reason: "gave up after 12 steps (2 candidates failed the check, 1 reply was not a change)" }, /^I couldn't make this change: I ran out of tries/],
    ["the engine cannot drive the loop", { kind: "failed", cause: "engine", reason: "cli is a one-shot completion, not a chat engine; it cannot use tools." }, /^I couldn't start on this change: .*Engine Settings/],
  ];

  for (const [how, outcome, plain] of giveUps) {
    it(`${how}: said plainly, with the loop's words kept as the detail`, async () => {
      const out = await modify(outcome);
      expect(out.kind).toBe("failed");
      if (out.kind !== "failed") return;
      expect(out.text).toMatch(plain);
      expect(out.text).not.toMatch(JARGON);
      expect(out.text).not.toMatch(/^Not changed —/);
      expect(out.detail).toBe(outcome.reason);
    });
  }

  it("stopped by the person: said plainly, nothing to detail", async () => {
    const out = await modify({ kind: "stopped" });
    expect(out).toEqual({ kind: "failed", text: "Stopped. Nothing was changed." });
  });

  it("refused as not the app's to change: an answer, in plain words, with the model's reason", async () => {
    const out = await modify({ kind: "diagnosis", text: "Your phone's settings decide the alarm sound, not this app." });
    expect(out.kind).toBe("refusal");
    if (out.kind !== "refusal") return;
    expect(out.text).toMatch(/^I didn't change the app: this isn't something it can change\. Your phone's settings/);
    expect(out.text).not.toMatch(/^Not changed —/);
  });

  it("something threw: a plain sentence, the error kept as the detail", async () => {
    const out = await modify(new Error("OpenRouter 401: invalid API key"));
    expect(out.kind).toBe("failed");
    if (out.kind !== "failed") return;
    expect(out.text).toMatch(/^I couldn't make this change: something went wrong/);
    expect(out.text).not.toMatch(JARGON);
    expect(out.detail).toBe("OpenRouter 401: invalid API key");
  });
});
