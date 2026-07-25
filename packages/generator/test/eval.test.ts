import { describe, expect, it } from "vitest";
import { FixtureBackend, PROMPTS, runEval, formatReport, type GenPrompt } from "../src/index.js";

const GOOD = `
import { defineApp } from "karta";
export default defineApp({
  id: "good", name: "Good", version: "1.0.0", schemaVersion: 1,
  entities: { t: { label: "T", displayField: "n", fields: { n: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "t", display: { primary: "n" } } }],
});
`;
const BROKEN = `export default { not: "a karta app" };`;

const prompts: GenPrompt[] = [
  { id: "good", description: "a good app" },
  { id: "bad", description: "an initially-broken app the backend can repair" },
];

describe("runEval", () => {
  it("aggregates pass rates and honours the repair loop", async () => {
    const backend = new FixtureBackend(
      { good: GOOD, bad: BROKEN },
      { bad: GOOD }, // the repair step returns a valid source
    );

    const report = await runEval(backend, prompts, { maxRepairs: 2 });

    expect(report.total).toBe(2);
    expect(report.singlePassValid).toBe(1); // only "good" validates first-pass
    expect(report.validWithinN).toBe(2); // "bad" validates after one repair
    expect(report.renders).toBe(2);

    const bad = report.outcomes.find((o) => o.prompt.id === "bad")!;
    expect(bad.singlePass.validates).toBe(false);
    expect(bad.repairsUsed).toBe(1);
    expect(bad.final.validates).toBe(true);

    expect(formatReport(report)).toContain("backend: fixture");
  });

  it("records repairsUsed = 0 when a backend cannot repair", async () => {
    const backend = new FixtureBackend({ bad: BROKEN });
    const report = await runEval(new NoRepair(backend), [{ id: "bad", description: "x" }], { maxRepairs: 3 });
    expect(report.validWithinN).toBe(0);
    expect(report.outcomes[0]!.repairsUsed).toBe(0);
  });

  it("ships a corpus spanning the field/view/logic surface", () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(PROMPTS.map((p) => p.id)).size).toBe(PROMPTS.length); // unique ids
  });
});

// A backend wrapper with no repair() to exercise the no-repair path.
class NoRepair {
  readonly name = "no-repair";
  constructor(private readonly inner: FixtureBackend) {}
  generate(p: GenPrompt): Promise<string> {
    return this.inner.generate(p);
  }
}
