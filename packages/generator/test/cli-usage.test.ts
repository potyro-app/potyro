import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { parseCliOutput } from "../src/cli-backend.js";
import { claudeCliAvailable } from "../src/cli-available.js";

// Reading the cost off `claude -p`.
//
// The CLI only reports tokens and spend under `--output-format json`; the backend asked for `text`
// until now, which is why the harness could count calls and never name a price. These tests pin the
// two things that matter about the change: the numbers come out when the envelope is there, and a
// generation is NEVER lost to an envelope that is not — an accounting change must not be able to
// throw away work that has already been paid for.

const ENVELOPE = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 41_233,
  result: "```ts\nexport default {}\n```",
  total_cost_usd: 0.1734,
  usage: { input_tokens: 12, cache_creation_input_tokens: 8_000, cache_read_input_tokens: 4_000, output_tokens: 3_120 },
  modelUsage: { "claude-opus-5": { inputTokens: 12 } },
});

describe("parseCliOutput", () => {
  it("reads the text, the tokens, the cost and the model out of the JSON envelope", () => {
    const { text, usage } = parseCliOutput(ENVELOPE);
    expect(text).toBe("```ts\nexport default {}\n```");
    expect(usage.costUsd).toBeCloseTo(0.1734, 6);
    expect(usage.outputTokens).toBe(3_120);
    // Cache reads and writes are input the call was billed for; leaving them out would understate
    // every long-context call in the corpus, which is all of them after the first modification.
    expect(usage.inputTokens).toBe(12 + 8_000 + 4_000);
    expect(usage.model).toBe("claude-opus-5");
  });

  it("treats output it cannot parse as the answer, with usage unknown", () => {
    const raw = "```ts\nexport default {}\n```";
    const { text, usage } = parseCliOutput(raw);
    expect(text).toBe(raw);
    expect(usage).toEqual({ model: null, inputTokens: null, outputTokens: null, costUsd: null });
  });

  it("treats a JSON object that is not the envelope as the answer too", () => {
    const raw = `{ "id": "not-an-envelope" }`;
    expect(parseCliOutput(raw).text).toBe(raw);
  });

  it("reports unknown rather than zero when the envelope carries no usage", () => {
    const { usage } = parseCliOutput(JSON.stringify({ result: "hi" }));
    expect(usage).toEqual({ model: null, inputTokens: null, outputTokens: null, costUsd: null });
  });

  it("surfaces an error the CLI reported instead of returning it as a source", () => {
    expect(() => parseCliOutput(JSON.stringify({ is_error: true, result: "Credit balance is too low" }))).toThrow(
      /Credit balance is too low/,
    );
  });
});

describe("claudeCliAvailable", () => {
  it("is false for a binary that is not on PATH", () => {
    expect(claudeCliAvailable("definitely-not-a-real-binary-9f3a")).toBe(false);
  });

  it("resolves an explicit path without consulting PATH", () => {
    expect(claudeCliAvailable(fileURLToPath(import.meta.url))).toBe(true);
    expect(claudeCliAvailable("./nope/not/here")).toBe(false);
  });
});
