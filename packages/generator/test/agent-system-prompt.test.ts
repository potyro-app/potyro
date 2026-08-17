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

  // The single most useful thing it can know: it does not have to re-check its own work, and a
  // rejection is information rather than a dead end.
  it("says a candidate is verified automatically, and what happens when it fails", () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/automatically|for you/i);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/did NOT fix|rejected|told/i);
  });

  it("tells it the data tool cannot show records, so it does not keep asking", () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/counts|shapes/i);
  });
});
