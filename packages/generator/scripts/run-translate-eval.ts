// Does a model keep an app's languages in step? (#302, docs/20 §5.3)
//
//   pnpm --filter @potyro/generator eval:translate:fixture      # no model, no money: the scorer on hand-written answers
//   OPENROUTER_API_KEY=… pnpm --filter @potyro/generator eval:translate -- --model deepseek/deepseek-v4-flash-0731 --max-calls 60 --max-cost 2
//   OPENROUTER_API_KEY=… pnpm --filter @potyro/generator eval:translate -- --only translate-groceries-fr,rename-quantity --max-calls 20 --max-cost 1
//
// The paid run spends real money: every case is the Studio's modify loop (`runModifyLoop`, with
// `translate` and the completeness check) against OpenRouter. It refuses to start without both
// `--max-calls` and `--max-cost`, and stops at either. Every answer is written to --out (default
// eval-out/translate) — a pass rate is unreadable without the answers.
//
// Flags: --fixture  --only a,b  --model id  --max-calls N  --max-cost USD  --out dir

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppDefinition } from "potyro";
import { loadApp } from "../src/score.js";
import { scoreTranslate, formatTranslateReport, type TranslateScore } from "../src/translate-eval.js";
import { translateCases } from "../src/translate-cases.js";
import { runModifyLoop } from "../src/agent/modify-loop.js";
import { buildDiscoveryTools } from "../src/agent/discovery-tools.js";
import { createDraft } from "../src/agent/translate-tool.js";
import { MODIFY_AGENT_SYSTEM_PROMPT } from "../src/agent/modify-system-prompt.js";
import { createOpenRouterEngine } from "../src/openrouter-backend.js";
import { meteredEngine, newMeter } from "../src/loop-eval.js";
import { loadCorpus } from "../src/load-corpus.js";
import type { ChatEngine } from "../src/chat-backend.js";

const examples = fileURLToPath(new URL("../../../examples/", import.meta.url));
const read = (file: string): string => readFileSync(join(examples, file), "utf8");
const load = async (source: string): Promise<AppDefinition> => (await loadApp(source, examples)) as unknown as AppDefinition;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const next = i >= 0 ? process.argv[i + 1] : undefined;
  return next && !next.startsWith("--") ? next : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const positive = (name: string): number | undefined => {
  const raw = arg(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number, got "${raw}"`);
  return n;
};

const out = resolve(arg("out") ?? "eval-out/translate");
const only = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const all = await translateCases(read);
const cases = only ? all.filter((c) => only.includes(c.case.id)) : all;
if (!cases.length) throw new Error(`no case matches --only ${only?.join(",")}; the cases are: ${all.map((c) => c.case.id).join(", ")}`);
mkdirSync(out, { recursive: true });

if (flag("fixture")) {
  // The scorer, on answers written by hand: a good one must pass and a bad one must fail. Free.
  const lines: string[] = [];
  let wrong = 0;
  for (const c of cases) {
    const good = await scoreTranslate(c.case, c.case.app, await c.good(), load);
    const bad = await scoreTranslate(c.case, c.case.app, await c.bad(), load);
    const ok = good.passed && !bad.passed;
    if (!ok) wrong += 1;
    lines.push(`${ok ? "ok  " : "WRONG"} ${c.case.id}: good ${good.passed ? "passes" : "fails"}, bad ${bad.passed ? "passes" : "fails"} (${bad.checks.filter((x) => !x.ok).map((x) => x.name).join("; ")})`);
  }
  const report = `eval:translate --fixture: the scorer on hand-written answers\n\n${lines.join("\n")}\n\n${wrong ? `${wrong} case(s) scored wrongly` : "every case scored as written"}\n`;
  writeFileSync(join(out, "fixture.txt"), report);
  console.log(report);
  process.exit(wrong ? 1 : 0);
}

const maxCalls = positive("max-calls");
const maxCost = positive("max-cost");
if (!maxCalls || !maxCost) throw new Error("A paid run needs both --max-calls and --max-cost. For a free run of the scorer, use --fixture.");
if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set.");
const model = arg("model");
const meter = newMeter();
const scores: TranslateScore[] = [];

/** The engine, refusing once a budget is spent — a case stops mid-way rather than going over. */
function budgeted(engine: ChatEngine): ChatEngine {
  return {
    chat: {
      completions: {
        create: async (req) => {
          if (meter.calls >= maxCalls!) throw new Error(`--max-calls ${maxCalls} reached`);
          if (meter.cost >= maxCost!) throw new Error(`--max-cost ${maxCost} reached ($${meter.cost.toFixed(3)})`);
          return engine.chat.completions.create(req);
        },
      },
    },
  };
}

for (const c of cases) {
  const draft = createDraft(c.case.app);
  const check = async (src: string): Promise<string[]> => {
    try {
      await load(src);
      return [];
    } catch (e) {
      return [e instanceof Error ? e.message : String(e)];
    }
  };
  let after = c.case.app;
  try {
    const result = await runModifyLoop({
      engine: budgeted(meteredEngine(createOpenRouterEngine(model ? { model } : {}), meter)),
      ...(model ? { model } : {}),
      tools: buildDiscoveryTools({ check, source: c.case.app, draft }),
      draft,
      corpus: loadCorpus,
      system: MODIFY_AGENT_SYSTEM_PROMPT,
      instruction: c.case.instruction,
      source: c.case.app,
      check,
      shapeOf: async () => ({ entities: {}, pages: [] }),
      before: { entities: {}, pages: [] },
    });
    if (result.kind === "source") after = result.source;
    writeFileSync(join(out, `${c.case.id}.outcome.json`), JSON.stringify(result.kind === "source" ? { kind: result.kind, rationale: result.rationale } : result, null, 2));
  } catch (e) {
    writeFileSync(join(out, `${c.case.id}.outcome.json`), JSON.stringify({ kind: "crashed", reason: String(e) }, null, 2));
  }
  writeFileSync(join(out, `${c.case.id}.after.ts`), after);
  scores.push(await scoreTranslate(c.case, c.case.app, after, load));
  if (meter.calls >= maxCalls || meter.cost >= maxCost) break;
}

const report = `${formatTranslateReport(scores)}\n\n${meter.calls} model calls, $${meter.cost.toFixed(3)}${meter.unpriced ? ` (+${meter.unpriced} unpriced calls)` : ""}\n`;
writeFileSync(join(out, "report.txt"), report);
console.log(report);
