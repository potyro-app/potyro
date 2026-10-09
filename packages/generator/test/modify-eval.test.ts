import { describe, expect, it } from "vitest";
import type { GenPrompt } from "../src/backend.js";
import type { MeteredBackend, MeteredRequest, MeteredResult } from "../src/model-call.js";
import { CallBudget } from "../src/model-call.js";
import { runModifyScenario, summarize } from "../src/modify-eval.js";
import { reviewSheet } from "../src/modify-report.js";
import type { ModifyScenario } from "../src/modify-scenarios.js";

// The harness, driven by a scripted backend so it never calls a model.
//
// That constraint is the point rather than a convenience: this suite runs in CI and on every commit,
// and a corpus that costs money on every push would be turned off within a week. Everything the
// paid run does — the chain, the migrations, the repair, the accounting, the budget — happens here
// against canned sources, so the only thing the live run adds is the model.

const app = (opts: {
  version: string;
  fields: string[];
  migrations?: string;
}): string => `import { defineApp } from "potyro";

export default defineApp({
  id: "notes",
  name: "Notes",
  version: "${opts.version}",
  schemaVersion: 1,
  entities: {
    note: {
      label: "Note",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
${opts.fields.map((f) => `        ${f}: { type: "text" },`).join("\n")}
      },
    },
  },
  pages: [
    { id: "all", title: "Notes", view: { type: "list", entity: "note", display: { primary: "title" } } },
  ],${opts.migrations ? `\n  migrations: ${opts.migrations},` : ""}
});`;
// No trailing newline: a reply is read with `extractSource`, which trims, so a source that has been
// through the harness never has one. A fixture that did would compare unequal to itself.

const V1 = app({ version: "1.0.0", fields: ["body"] });
/** Adds a field, declared. The well-behaved change. */
const V2 = app({
  version: "1.1.0",
  fields: ["body", "summary"],
  migrations: `[{ from: "1.0.0", to: "1.1.0", steps: [{ op: "addField", entity: "note", field: "summary", default: "" }] }]`,
});
/** Removes `body` and SAYS SO. The values go, and that is what was asked for. */
const V3_DECLARED = app({
  version: "1.2.0",
  fields: ["summary"],
  migrations: `[{ from: "1.1.0", to: "1.2.0", steps: [{ op: "dropField", entity: "note", field: "body" }] }]`,
});
/** Removes `body` from the app and says nothing. Every record keeps its value where nobody can see it. */
const V3_SILENT = app({ version: "1.1.0", fields: ["summary"] });
/**
 * A whole-file reply that is app-SHAPED and does not validate — what the one repair exists for.
 *
 * It has to MENTION `defineApp(` to be read as a whole file at all. A modify reply carrying neither
 * edits nor an app is not a broken app, it is prose, and `callModel` reports it as a call that
 * produced nothing rather than handing the harness something to score — so a fixture that wanted to
 * exercise the REPAIR loop has to be the other failure: a file that looks like an app and whose
 * default export is not one.
 */
const BROKEN = `import { defineApp } from "potyro";

export const nope = () => defineApp({});
export default { not: "a potyro app" };`;

/**
 * A backend that reads from a script instead of a model, and reports whatever usage it is given.
 *
 * The script holds REPLIES, not sources: what the model said. For `generate` and `repair` those look
 * the same, and for `modify` a whole app source is one of the two replies the contract accepts (the
 * other being SEARCH/REPLACE edits), so the fixtures below read as whole-file modifications.
 */
class ScriptedBackend implements MeteredBackend {
  readonly name = "scripted";
  readonly seen: MeteredRequest[] = [];
  constructor(
    private readonly script: { generate?: string[]; modify?: string[]; repair?: string[] },
    private readonly usage: MeteredResult["usage"] = {
      model: "test-model",
      inputTokens: 100,
      outputTokens: 200,
      costUsd: 0.01,
    },
  ) {}

  async meteredCall(req: MeteredRequest): Promise<MeteredResult> {
    this.seen.push(req);
    const queue = this.script[req.kind];
    const text = queue?.shift();
    if (text === undefined) throw new Error(`the script has no ${req.kind} left`);
    return { text, usage: this.usage };
  }

  async generate(prompt: GenPrompt): Promise<string> {
    return (await this.meteredCall({ kind: "generate", prompt })).text;
  }
  async modify(source: string, instruction: string, prompt: GenPrompt): Promise<string> {
    return (await this.meteredCall({ kind: "modify", source, instruction, prompt })).text;
  }
  async repair(source: string, errors: string[], prompt: GenPrompt): Promise<string> {
    return (await this.meteredCall({ kind: "repair", source, errors, prompt })).text;
  }
}

const scenario = (mods: string[]): ModifyScenario => ({
  id: "notes",
  description: "Somewhere to keep notes.",
  mods: mods.map((instruction) => ({ instruction })),
});

const THREE = scenario(["add a summary", "drop the body", "leave it alone"]);

describe("runModifyScenario", () => {
  it("records the chain: instructions in order, both sources per step, and a blank human field", async () => {
    const backend = new ScriptedBackend({ generate: [V1], modify: [V2, V3_DECLARED, V3_DECLARED] });
    const run = await runModifyScenario(backend, THREE, 1);

    expect(run.generated).toBe(true);
    expect(run.request).toBe("Somewhere to keep notes.");
    expect(run.generation.source).toBe(V1);
    expect(run.steps.map((s) => s.instruction)).toEqual(["add a summary", "drop the body", "leave it alone"]);

    // Every step says what it was applied to and what it produced — the report is unreadable
    // without both, and a step-2 diff against the ORIGINAL would describe a change nobody made.
    expect(run.steps[0]!.sourceBefore).toBe(V1);
    expect(run.steps[0]!.sourceAfter).toBe(V2);
    expect(run.steps[1]!.sourceBefore).toBe(V2);
    expect(run.steps[1]!.sourceAfter).toBe(V3_DECLARED);

    for (const step of run.steps) {
      expect(step.human).toEqual({ score: null, note: "" });
      expect(step.durationMs).toBeGreaterThanOrEqual(0);
      expect(new Date(step.endedAt).getTime()).toBeGreaterThanOrEqual(new Date(step.startedAt).getTime());
    }
  }, 60_000);

  it("passes a declared field removal and flags an undeclared one", async () => {
    const declared = await runModifyScenario(
      new ScriptedBackend({ generate: [V1], modify: [V2, V3_DECLARED] }),
      scenario(["add a summary", "drop the body"]),
      1,
    );
    const dropped = declared.steps[1]!;
    expect(dropped.recordsSurvived).toBe(true);
    expect(dropped.data!.removedFields).toEqual([{ entity: "note", field: "body", explained: "dropField note.body" }]);
    expect(dropped.data!.verdict).toBe("ok");
    expect(dropped.verdict).toBe("clean");

    // The same visible outcome, with nothing declaring it. Every record is still there, still on the
    // list page, still reachable — and what was in `body` is now unreachable through the app.
    const silent = await runModifyScenario(
      new ScriptedBackend({ generate: [V1], modify: [V2, V3_SILENT] }),
      scenario(["add a summary", "drop the body"]),
      1,
    );
    const orphaned = silent.steps[1]!;
    expect(orphaned.recordsSurvived).toBe(true);
    expect(orphaned.stillReachable).toBe(true);
    expect(orphaned.data!.orphanedFields).toEqual([{ entity: "note", field: "body", records: 3 }]);
    expect(orphaned.verdict).toBe("review");
    expect(orphaned.findings.join(" ")).toContain("no longer declares it");
  }, 60_000);

  it("uses the ONE repair the product allows, and no more", async () => {
    const backend = new ScriptedBackend({ generate: [V1], modify: [BROKEN], repair: [V2] });
    const run = await runModifyScenario(backend, scenario(["add a summary"]), 1);

    const step = run.steps[0]!;
    expect(step.repaired).toBe(true);
    expect(step.valid).toBe(true);
    expect(step.calls.map((c) => c.kind)).toEqual(["modify", "repair"]);
    expect(backend.seen.filter((r) => r.kind === "repair")).toHaveLength(1);
    // The draft the repair was handed is kept: a repair reviewed without it says nothing.
    expect(step.rejectedSource).toBe(BROKEN);
    expect(step.validationErrors.join(" ")).toContain("not a validated PotyroApp");
  }, 60_000);

  it("stops the chain when a modification stays invalid, rather than modifying nothing", async () => {
    const backend = new ScriptedBackend({ generate: [V1], modify: [BROKEN, V2], repair: [BROKEN] });
    const run = await runModifyScenario(backend, THREE, 1);

    expect(run.steps).toHaveLength(1);
    expect(run.steps[0]!.valid).toBe(false);
    expect(run.steps[0]!.remainingErrors.length).toBeGreaterThan(0);
    expect(run.stoppedBecause).toBe("the source does not validate");
    // The second modification was never attempted — there was nothing to apply it to.
    expect(backend.seen.filter((r) => r.kind === "modify")).toHaveLength(1);
  }, 60_000);

  it("accounts for every call, and sums usage the backend reported", async () => {
    const backend = new ScriptedBackend({ generate: [V1], modify: [BROKEN, V3_DECLARED], repair: [V2] });
    const budget = new CallBudget();
    const started = Date.now();
    const run = await runModifyScenario(backend, scenario(["add a summary", "drop the body"]), 1, budget);
    const report = summarize(backend.name, [run], budget, started);

    expect(report.calls).toMatchObject({ total: 4, generate: 1, modify: 2, repair: 1, failed: 0 });
    expect(report.usage).toMatchObject({ inputTokens: 400, outputTokens: 800, costEnforceable: true, unmeteredCalls: 0 });
    expect(report.usage.costUsd).toBeCloseTo(0.04, 6);
    expect(report.models).toEqual(["test-model"]);
  }, 60_000);

  it("says unknown rather than nothing when the backend reports no usage", async () => {
    const backend = new ScriptedBackend(
      { generate: [V1], modify: [V2] },
      { model: null, inputTokens: null, outputTokens: null, costUsd: null },
    );
    const budget = new CallBudget();
    const run = await runModifyScenario(backend, scenario(["add a summary"]), 1, budget);
    const report = summarize(backend.name, [run], budget, Date.now());

    expect(report.usage.costUsd).toBeNull();
    expect(report.usage.costEnforceable).toBe(false);
    expect(report.usage.unmeteredCalls).toBe(2);
    expect(report.models).toEqual([]);
    // And the sheet says so in words, rather than printing a confident $0.00.
    const sheet = reviewSheet(report);
    expect(sheet).toContain("| reported cost | unknown |");
    expect(sheet).toContain("A monetary ceiling could not be enforced");
  }, 60_000);
});

describe("CallBudget", () => {
  it("stops a chain at --max-calls and reports what it had", async () => {
    const backend = new ScriptedBackend({ generate: [V1], modify: [V2, V3_DECLARED, V3_DECLARED] });
    const budget = new CallBudget({ maxCalls: 2 });
    const run = await runModifyScenario(backend, THREE, 1, budget);
    const report = summarize(backend.name, [run], budget, Date.now());

    expect(report.calls.total).toBe(2); // the generate, and one modify
    expect(report.partial).toBe(true);
    expect(report.stoppedBecause).toContain("--max-calls 2");
    expect(run.steps).toHaveLength(1); // and what it did learn is kept
    expect(run.steps[0]!.valid).toBe(true);
  }, 60_000);

  it("refuses to run under a ceiling the backend cannot enforce, unless told to", async () => {
    const unmetered = { model: null, inputTokens: null, outputTokens: null, costUsd: null };
    const strict = new CallBudget({ maxCostUsd: 5 });
    await runModifyScenario(new ScriptedBackend({ generate: [V1], modify: [V2, V3_DECLARED] }, unmetered), THREE, 1, strict);
    expect(strict.stopReason).toContain("did not report the cost");
    expect(strict.calls).toBe(1); // it stopped on the first unmetered call, not after the corpus

    const permitted = new CallBudget({ maxCostUsd: 5, allowUnmetered: true });
    const run = await runModifyScenario(
      new ScriptedBackend({ generate: [V1], modify: [V2, V3_DECLARED, V3_DECLARED] }, unmetered),
      THREE,
      1,
      permitted,
    );
    expect(permitted.stopReason).toBeNull();
    expect(run.steps).toHaveLength(3);
  }, 60_000);

  it("stops once reported spend reaches --max-cost", () => {
    const budget = new CallBudget({ maxCostUsd: 0.05 });
    const call = (costUsd: number) => ({
      kind: "modify" as const,
      startedAt: "", endedAt: "", durationMs: 1,
      model: "m", inputTokens: 1, outputTokens: 1, costUsd, failed: false,
    });
    expect(budget.canSpend()).toBe(true);
    budget.record(call(0.03));
    expect(budget.stopReason).toBeNull();
    expect(budget.canSpend()).toBe(true);
    budget.record(call(0.03));
    expect(budget.stopReason).toContain("--max-cost 0.05");
    expect(budget.canSpend()).toBe(false);
  });
});
