import { describe, expect, it } from "vitest";
import { createCase } from "../src/create-eval.js";
import { scriptedCreateEngine, summarizeLoop } from "../src/loop-eval.js";
import { buildCorpus } from "../src/corpus.js";
import { scoreSource } from "../src/score.js";
import type { ChatEngine, ChatRequest } from "../src/chat-backend.js";

// `eval:cli --loop` (#262 phase 3), proven with no model: the scripted create engines go through the
// real loop with the eval's real gates (esbuild, the validator, the smoke run), and each must come
// back with the counts its description promises.

const corpus = async () => buildCorpus([]);
const seenBy = (engine: ChatEngine): { engine: ChatEngine; seen: ChatRequest[] } => {
  const seen: ChatRequest[] = [];
  return { seen, engine: { chat: { completions: { create: async (req) => (seen.push({ ...req, messages: [...req.messages] }), engine.chat.completions.create(req)) } } } };
};

describe("createCase: one create through the loop, metered", () => {
  it("scripted-create-loop: passes on its first candidate from the first draft, in two calls", async () => {
    const { source, record } = await createCase({ engine: scriptedCreateEngine("scripted-create-loop"), brief: "notes", corpus });
    expect(record).toMatchObject({ ended: "source", passedOn: 1, drafts: 1, passedOnDraft: 1, calls: 2, cause: null });
    expect(record.cost).toBeGreaterThan(0);
    expect((await scoreSource(source)).validates).toBe(true);
  }, 60_000);

  it("scripted-create-loop-second: the first draft fails validation, the second independent draft passes", async () => {
    const { engine, seen } = seenBy(scriptedCreateEngine("scripted-create-loop-second"));
    const { record } = await createCase({ engine, brief: "notes", corpus });
    expect(record).toMatchObject({ ended: "source", passedOn: 2, drafts: 2, passedOnDraft: 2, calls: 2 });
    expect(seen[1]!.messages).toHaveLength(2);
  }, 60_000);

  it("scripted-create-loop-second with drafts 1: the one draft is repaired instead", async () => {
    const { record } = await createCase({ engine: scriptedCreateEngine("scripted-create-loop-second"), brief: "notes", drafts: 1, corpus });
    expect(record).toMatchObject({ ended: "source", passedOn: 2, drafts: 1, passedOnDraft: 1 });
  }, 60_000);

  it("scripted-create-loop-repair: both drafts fail, the repair passes on candidate 3", async () => {
    const { record } = await createCase({ engine: scriptedCreateEngine("scripted-create-loop-repair"), brief: "notes", corpus });
    expect(record).toMatchObject({ ended: "source", passedOn: 3, drafts: 2, calls: 3 });
    const s = summarizeLoop([record]);
    expect(s.secondDrafts).toBe(1);
    expect(s.passedOn["3"]).toBe(1);
  }, 60_000);
});
