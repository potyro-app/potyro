import { describe, expect, it } from "vitest";
import { scoreSource } from "../src/index.js";
import { EXAMPLE_TODO, EXAMPLE_COMPUTED } from "../src/prompt.js";

// The few-shot examples in the system prompt teach the model the contract AND the good-UX patterns
// (icons, quickActions, list → hidden detail via onOpen). They must themselves be valid apps — a
// broken example teaches broken patterns. Score both through the same compile+validate+render gates.

describe("system-prompt few-shot examples are valid apps", () => {
  it("EXAMPLE_TODO compiles, validates, and renders", async () => {
    const r = await scoreSource(EXAMPLE_TODO);
    expect(r).toMatchObject({ compiles: true, validates: true, renders: true });
    expect(r.errors).toEqual([]);
  });

  it("EXAMPLE_COMPUTED (icons + quickActions + list→hidden detail) is valid", async () => {
    const r = await scoreSource(EXAMPLE_COMPUTED);
    expect(r).toMatchObject({ compiles: true, validates: true, renders: true });
    expect(r.errors).toEqual([]);
  });
});
