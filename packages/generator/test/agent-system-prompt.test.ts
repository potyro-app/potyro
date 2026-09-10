import { describe, expect, it } from "vitest";
import { AGENT_SYSTEM_PROMPT } from "../src/agent/system-prompt.js";
import { SYSTEM_PROMPT } from "../src/prompt.js";

describe("the agent's system prompt", () => {
  it("still teaches the app contract, because the agent has to write one", () => {
    expect(AGENT_SYSTEM_PROMPT).toContain(SYSTEM_PROMPT);
  });

  it("names every tool the loop actually provides", () => {
    for (const tool of ["replay_case", "inspect_app", "query_data"]) {
      expect(AGENT_SYSTEM_PROMPT).toContain(tool);
    }
  });

  it("states the three legal reply shapes", () => {
    expect(AGENT_SYSTEM_PROMPT).toContain("ASK:");
    expect(AGENT_SYSTEM_PROMPT).toContain("NOT-IN-APP:");
    expect(AGENT_SYSTEM_PROMPT).toMatch(/```ts/);
  });

  // The contract changed from "send the complete updated file" to "send SEARCH/REPLACE edits" —
  // pin both halves of that, not just the presence of the new format.
  it("asks for SEARCH/REPLACE edits, not the whole file", () => {
    expect(AGENT_SYSTEM_PROMPT).toContain("<<<<<<< SEARCH");
    expect(AGENT_SYSTEM_PROMPT).not.toMatch(/whole file, not a diff/i);
  });

  // The single most useful thing it can know: it does not have to re-check its own work, and a
  // rejection is information rather than a dead end.
  it("says a candidate is verified automatically, and what happens when it fails", () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/automatically|for you/i);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/did NOT fix|rejected|told/i);
  });

  // FINDING 3: query_data's description is DERIVED in app-tools.ts from `allowsRawRecords`, so it
  // is accurate by construction. Hardcoding the same claim ("counts only") one layer up in this
  // prompt reintroduces the drift that design removed — if raw access is ever granted, the tool
  // schema and this prompt would disagree, and the model reasons from both. So the prompt must say
  // WHEN to use the tool, and leave WHAT it returns to the tool's own schema.
  it("does not hardcode a return-shape claim for query_data, leaving that to the tool's own schema", () => {
    // "query_data" is still named — covered by the "names every tool" test above — but this prompt
    // must not itself assert what the tool returns.
    expect(AGENT_SYSTEM_PROMPT).not.toMatch(/counts and shapes only/i);
    expect(AGENT_SYSTEM_PROMPT).not.toMatch(/returns counts only/i);
  });

  // FINDING 1: loop.ts detects ASK: / NOT-IN-APP: with `startsWith` on the TRIMMED reply — a marker
  // that shows up after some lead-in prose is not recognized as a verdict at all, and falls through
  // to the candidate branch instead. The prompt must say the marker has to OPEN the reply, and why.
  it("says the ASK/NOT-IN-APP marker must be the first thing in the reply, and why", () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/first thing in your reply/i);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/starts with the marker|STARTS WITH the marker/i);
  });

  // FINDING 2: the embedded SYSTEM_PROMPT ends by demanding "No prose before or after", but loop.ts
  // takes the text before the fence as the fix's `rationale` and shows it to the person. Without an
  // explicit override, the composed prompt tells the model both to omit prose and to provide it.
  it("overrides the embedded prompt's no-prose rule for this context, and says why", () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/overriding the output section/i);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/reasoning BEFORE the.*```ts block/i);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/rationale/i);
  });
});
