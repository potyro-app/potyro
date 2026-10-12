import { describe, expect, it } from "vitest";
import { MODIFY_AGENT_SYSTEM_PROMPT } from "../src/agent/modify-system-prompt.js";
import { SYSTEM_PROMPT } from "../src/prompt.js";

describe("MODIFY_AGENT_SYSTEM_PROMPT", () => {
  it("builds on the generator contract and the schema reference", () => {
    expect(MODIFY_AGENT_SYSTEM_PROMPT).toContain(SYSTEM_PROMPT);
  });

  it("explains every discovery tool by name", () => {
    for (const tool of ["lookup", "check", "example", "search_corpus", "read"]) expect(MODIFY_AGENT_SYSTEM_PROMPT).toContain(`\`${tool}\``);
  });

  it("says a refusal without looking is not accepted, and that the marker must open the reply", () => {
    expect(MODIFY_AGENT_SYSTEM_PROMPT).toMatch(/NOT-IN-APP .* not accepted/);
    expect(MODIFY_AGENT_SYSTEM_PROMPT).toMatch(/VERY FIRST THING/);
  });

  it("frames the task as a change to an existing app, not a new one", () => {
    expect(MODIFY_AGENT_SYSTEM_PROMPT).toMatch(/NOT WRITING A NEW ONE/);
  });
});
