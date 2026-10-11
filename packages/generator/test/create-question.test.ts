// Before it builds, the agent may ask (#261). The Studio became a conversation, and the cheapest
// way to a wrong app is building one from "a tracker" without asking what it tracks. The contract
// allows ONE line instead of the source; nothing else about a create changes.

import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, questionIn } from "../src/prompt.js";

describe("a create may answer with a question", () => {
  it("is allowed by the contract, once, and only when the answer would change the app", () => {
    expect(SYSTEM_PROMPT).toMatch(/QUESTION: /);
    expect(SYSTEM_PROMPT).toMatch(/One question at a time/);
  });

  it("is read from a reply that is only the question", () => {
    expect(questionIn("QUESTION: Do you want to rate the books?")).toBe("Do you want to rate the books?");
    // Dressed the way models dress a marker.
    expect(questionIn("**QUESTION:** Indoor or outdoor plants?")).toBe("Indoor or outdoor plants?");
    expect(questionIn("`QUESTION: Who uses it?`")).toBe("Who uses it?");
    expect(questionIn("```ts\nQUESTION: Who uses it?\n```")).toBe("Who uses it?");
  });

  it("is not read from an app, nor from prose that mentions the word", () => {
    expect(questionIn('import { defineApp } from "potyro";\n// QUESTION: none\nexport default defineApp({})')).toBeNull();
    expect(questionIn("I had a question about this but decided to build the smaller app.")).toBeNull();
    expect(questionIn("QUESTION:   ")).toBeNull();
    // Only when the reply opens with it.
    expect(questionIn("Renaming the page.\nQUESTION: this line is not the reply")).toBeNull();
  });
});
