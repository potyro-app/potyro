// The stand-in AI (#74): an answer to any schema without a model, three ways.

import { describe, expect, it } from "vitest";
import { AI_ANSWER_PASSES, FakeCapabilities, StandInAi, UNLISTED_TEXT, answerSchema, standInPicture } from "../src/index.js";

// As `ctx.caps.ai.extract` writes a shape for the service (host/src/ai.ts `jsonSchemaFor`).
const LABEL = {
  type: "object",
  properties: {
    name: { type: "string" },
    grape: { type: ["string", "null"] },
    colour: { type: ["string", "null"], enum: ["red", "white", null] },
    alcohol: { type: ["number", "null"] },
    bio: { type: ["boolean", "null"] },
    bottled: { type: ["string", "null"], description: "a date, YYYY-MM-DD" },
    awards: { type: "array", items: { type: "object", properties: { title: { type: "string" }, year: { type: "number" } } } },
  },
};

describe("answerSchema", () => {
  it("plausible: a value of the right type for every key, one of the options where there are options", () => {
    const a = answerSchema(LABEL, "plausible");
    expect(a.value).toEqual({
      name: "Sample name",
      grape: "Sample grape",
      colour: "red",
      alcohol: 12,
      bio: true,
      bottled: "2024-05-17",
      awards: [
        { title: "Sample title", year: 12 },
        { title: "Sample title", year: 12 },
      ],
    });
    expect(a.missing).toEqual([]);
    expect(a.unlisted).toEqual([]);
  });

  it("plausible: a key known to be written into a list is answered from that list", () => {
    const a = answerSchema(LABEL, "plausible", (key) => (key === "grape" ? ["merlot", "syrah"] : undefined));
    expect((a.value as { grape: string }).grape).toBe("merlot");
  });

  it("missing: null wherever the schema allows it, an empty list for a list — and what is required still there", () => {
    const a = answerSchema(LABEL, "missing", () => ["merlot"]);
    expect(a.value).toEqual({ name: "merlot", grape: null, colour: null, alcohol: null, bio: null, bottled: null, awards: [] });
    expect(a.missing).toEqual(["grape", "colour", "alcohol", "bio", "bottled", "awards"]);
  });

  it("unlisted: every free text is in no list, whatever the list; options, dates and numbers keep their form", () => {
    const a = answerSchema(LABEL, "unlisted", () => ["merlot"]);
    expect(a.value).toMatchObject({ name: UNLISTED_TEXT, grape: UNLISTED_TEXT, colour: "red", alcohol: 12, bottled: "2024-05-17" });
    expect(a.unlisted).toEqual(["name", "grape", "awards[].title"]);
  });

  it("answers the same way every time", () => {
    for (const pass of AI_ANSWER_PASSES) expect(answerSchema(LABEL, pass)).toEqual(answerSchema(LABEL, pass));
  });
});

describe("StandInAi", () => {
  it("answers a request's schema as JSON, in the pass it is set to, and keeps what it was asked", async () => {
    const ai = new StandInAi();
    const call = { system: "", parts: [{ text: "a label" }], json: LABEL, maxTokens: 100 };
    expect(JSON.parse((await ai.complete(call)).text).grape).toBe("Sample grape");
    ai.pass = "missing";
    expect(JSON.parse((await ai.complete(call)).text).grape).toBeNull();
    expect(ai.asked).toBe(2);
    expect(ai.schemas).toEqual([LABEL, LABEL]);
    expect(ai.answers[1]!.missing).toContain("grape");
    ai.reset();
    expect([ai.asked, ai.answers.length, ai.schemas.length]).toEqual([0, 0, 0]);
  });

  it("answers a request for words with a sentence, and is allowed without anyone being asked", async () => {
    const ai = new StandInAi();
    expect((await ai.complete({ system: "", parts: [{ text: "What is this?" }], maxTokens: 100 })).text).toBe(`${UNLISTED_TEXT}.`);
    expect(ai.standing()).toBe("on");
    expect(ai.answers).toEqual([]);
  });

  it("is a capability like any other, beside a camera that hands over a real picture", async () => {
    const caps = new FakeCapabilities({ ai: new StandInAi(), blob: standInPicture() });
    const shot = await caps.camera!.capture();
    expect(shot.type).toBe("image/png");
    expect(Array.from(new Uint8Array(await shot.arrayBuffer()).slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(caps.ai).toBeInstanceOf(StandInAi);
  });
});
