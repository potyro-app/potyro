// Produce a review sheet with no model, so the FORMAT can be argued about before any money is spent.
//
//   pnpm --filter @karta/generator eval:modify:fixture
//   pnpm.cmd --filter @karta/generator eval:modify:fixture     # Windows
//
// The sheet is the deliverable of a paid run — the thing a founder reads to decide whether AI
// editing is safe enough for an external user. Reviewing its shape by spending €15 and then finding
// the columns are wrong would be an expensive way to learn about columns.
//
// The three chains here are chosen to show one of each verdict, because a sample sheet where
// everything passes says nothing about how a failure reads:
//
//   clean   every check passed and nothing needs a person
//   review  the app quietly stopped declaring a field whose values are still in the store
//   failed  a modification that never produced a valid app, and the chain stopping there
//
// Nothing here is a measurement. The numbers are fixtures; only the layout is real.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { GenPrompt } from "../src/backend.js";
import type { MeteredBackend, MeteredRequest, MeteredResult } from "../src/model-call.js";
import { CallBudget } from "../src/model-call.js";
import { runModifyScenario, summarize, type ScenarioRun } from "../src/modify-eval.js";
import { artifactPath, formatModifyReport, rejectedPath, reviewSheet } from "../src/modify-report.js";
import type { ModifyScenario } from "../src/modify-scenarios.js";

const app = (opts: { version: string; fields: string[]; secondary?: string; migrations?: string }): string => `import { defineApp } from "karta";

export default defineApp({
  id: "reading",
  name: "Reading",
  version: "${opts.version}",
  schemaVersion: 1,
  entities: {
    book: {
      label: "Book",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
${opts.fields.map((f) => `        ${f},`).join("\n")}
      },
    },
  },
  pages: [
    { id: "all", title: "Reading", view: { type: "list", entity: "book", display: { primary: "title", secondary: "${opts.secondary ?? "notes"}" } } },
  ],${opts.migrations ? `\n  migrations: ${opts.migrations},` : ""}
});
`;

const V1 = app({ version: "1.0.0", fields: [`notes: { type: "text" }`] });
const V2 = app({
  version: "1.1.0",
  fields: [`notes: { type: "text" }`, `rating: { type: "number", min: 1, max: 5 }`],
  migrations: `[{ from: "1.0.0", to: "1.1.0", steps: [{ op: "addField", entity: "book", field: "rating" }] }]`,
});
const V3_CLEAN = app({
  version: "1.2.0",
  fields: [`notes: { type: "text" }`, `rating: { type: "number", min: 1, max: 5 }`, `finished: { type: "boolean", default: false }`],
  migrations:
    `[{ from: "1.0.0", to: "1.1.0", steps: [{ op: "addField", entity: "book", field: "rating" }] },\n` +
    `    { from: "1.1.0", to: "1.2.0", steps: [{ op: "addField", entity: "book", field: "finished", default: false }] }]`,
});
/**
 * The quiet one: `notes` is gone from the app and still in every record.
 *
 * Note what it takes to get here — the page has to stop referencing the field too, or the schema
 * validator rejects the app outright. Which is the point: the version of this failure that reaches
 * a user is the tidy one, where the model removed the field AND every mention of it, and the app
 * validates, renders, and shows every book exactly where it was, minus what you wrote about it.
 */
const V3_ORPHANS = app({
  version: "1.1.0",
  fields: [`rating: { type: "number", min: 1, max: 5 }`],
  secondary: "rating",
});
const BROKEN = `export default { not: "a karta app" };`;

interface Script {
  generate?: string[];
  modify?: string[];
  repair?: string[];
}

class ScriptedBackend implements MeteredBackend {
  readonly name = "fixture (no model was called)";
  private calls = 0;
  constructor(private readonly script: Script) {}

  async meteredCall(req: MeteredRequest): Promise<MeteredResult> {
    const source = this.script[req.kind]?.shift();
    if (source === undefined) throw new Error(`the fixture script has no ${req.kind} left`);
    this.calls += 1;
    // Plausible-looking numbers, varied so the sheet does not read as a template.
    return {
      source,
      usage: {
        model: "fixture-model",
        inputTokens: 6_000 + this.calls * 900,
        outputTokens: 2_200 + this.calls * 140,
        costUsd: 0.11 + this.calls * 0.017,
      },
    };
  }
  async generate(prompt: GenPrompt): Promise<string> {
    return (await this.meteredCall({ kind: "generate", prompt })).source;
  }
  async modify(source: string, instruction: string, prompt: GenPrompt): Promise<string> {
    return (await this.meteredCall({ kind: "modify", source, instruction, prompt })).source;
  }
  async repair(source: string, errors: string[], prompt: GenPrompt): Promise<string> {
    return (await this.meteredCall({ kind: "repair", source, errors, prompt })).source;
  }
}

const scenario = (id: string, description: string, mods: string[]): ModifyScenario => ({
  id,
  description,
  mods: mods.map((instruction) => ({ instruction })),
});

const MODS = ["let me rate a book out of five", "let me mark one as finished", "show me what I finished this month"];

const CASES: { scenario: ModifyScenario; script: Script }[] = [
  {
    scenario: scenario("reading-clean", "Books I'm reading, with what I thought of them.", MODS),
    script: { generate: [V1], modify: [V2, V3_CLEAN, V3_CLEAN] },
  },
  {
    scenario: scenario("reading-orphaned", "Books I'm reading, with what I thought of them.", MODS),
    script: { generate: [V1], modify: [V2, V3_ORPHANS, V3_ORPHANS] },
  },
  {
    scenario: scenario("reading-broken", "Books I'm reading, with what I thought of them.", MODS),
    script: { generate: [V1], modify: [BROKEN], repair: [BROKEN] },
  },
];

function write(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

async function main(): Promise<void> {
  const outDir = resolve(process.cwd(), process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1]! : "eval-out/fixture");
  const budget = new CallBudget();
  const started = Date.now();
  const runs: ScenarioRun[] = [];

  for (const { scenario: s, script } of CASES) {
    const run = await runModifyScenario(new ScriptedBackend({ ...script }), s, 1, budget);
    if (run.generation.source) write(join(outDir, artifactPath(run, "generated")), run.generation.source);
    if (run.generation.rejectedSource) write(join(outDir, rejectedPath(run, "generated")), run.generation.rejectedSource);
    for (const step of run.steps) {
      if (step.sourceAfter) write(join(outDir, artifactPath(run, step.index)), step.sourceAfter);
      if (step.rejectedSource) write(join(outDir, rejectedPath(run, step.index)), step.rejectedSource);
    }
    runs.push(run);
    console.log(`  ${run.scenario}  ${run.steps.map((st) => `${st.index}:${st.verdict}`).join(" ")}`);
  }

  const report = summarize("fixture", runs, budget, started);
  write(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  write(join(outDir, "review.md"), reviewSheet(report));
  console.log(`\n${formatModifyReport(report)}`);
  console.log(`\nreview sheet: ${join(outDir, "review.md")}`);
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
