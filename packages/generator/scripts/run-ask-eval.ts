// Put real requests to Ask (#213) and keep everything, so its answers can be READ — the only way to
// judge whether "add vegetarian restaurants" produced restaurants, a question, or invented places.
//
//   OPENROUTER_API_KEY=sk-or-… pnpm --filter @karta/generator eval:ask -- --model deepseek/deepseek-v4-flash-0731
//
// Flags: --model <openrouter id>[,<id>…]  --only <case id>[,…]  --reasoning none|low|medium|high
//        --web (let the model search the web)  --out <dir>
//
// Each case is an example app, what the person asked, and what the device knows about them — the
// context Ask sends beside the app's structure. Every request and response is written to
// <out>/<model>/<case>.json with tokens and cost, and a summary table is printed. Paid: a full run
// over one model is a few cents on a flash model, tens of cents on a frontier one.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppDefinition } from "karta";
import { createOpenRouterEngine, type ReasoningEffort } from "../src/openrouter-backend.js";
import { runAskLoop, type AskContext, type AskOutcome } from "../src/agent/ask.js";
import { ASK_CASES, type AskCase } from "../src/ask-cases.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Exchange {
  request: unknown;
  response: unknown;
}

async function loadExample(file: string): Promise<AppDefinition> {
  const mod = (await import(resolve(__dirname, "../../../examples", file))) as { default: AppDefinition };
  return mod.default;
}

async function runCase(model: string, c: AskCase, reasoning: ReasoningEffort, outDir: string, webSearch: boolean) {
  const exchanges: Exchange[] = [];
  const engine = createOpenRouterEngine({
    model,
    reasoning: { effort: reasoning },
    fetch: async (url, init) => {
      const res = await globalThis.fetch(url, init);
      const text = await res.text();
      let response: unknown = text;
      try {
        response = JSON.parse(text.split("\n").filter((l) => l.trim() && !l.startsWith(":")).join("\n"));
      } catch {
        // kept as text
      }
      exchanges.push({ request: JSON.parse(String(init?.body ?? "{}")), response });
      return new Response(text, { status: res.status, headers: res.headers });
    },
  });
  const definition = typeof c.app === "string" ? await loadExample(c.app) : c.app;
  const started = Date.now();
  let outcome: AskOutcome;
  try {
    outcome = await runAskLoop({ engine, model, definition, request: c.request, context: c.context as AskContext | undefined, webSearch, material: c.material });
  } catch (e) {
    outcome = { kind: "failed", reason: e instanceof Error ? e.message : String(e) };
  }
  const secs = (Date.now() - started) / 1000;
  const usage = exchanges.map((x) => (x.response as { usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } }).usage ?? {});
  const cost = usage.reduce((s, u) => s + (u.cost ?? 0), 0);
  const tokens = usage.reduce((s, u) => s + (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0), 0);
  const dir = join(outDir, model.replace(/[/:]/g, "_"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${c.id}.json`), JSON.stringify({ case: c, model, secs, cost, tokens, outcome, exchanges }, null, 2));
  return { outcome, secs, cost, tokens, turns: exchanges.length };
}

function describe(o: AskOutcome): string {
  if (o.kind === "proposal") {
    const counts: Record<string, number> = {};
    for (const t of Object.values(o.proposal.trust ?? {})) counts[t.status] = (counts[t.status] ?? 0) + 1;
    const trust = Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(", ");
    return `proposal: ${o.proposal.rows.length} rows, ${o.proposal.citations?.length ?? 0} cited | ${trust}`;
  }
  if (o.kind === "answer") return `ANSWER: ${o.text.replace(/\s+/g, " ").slice(0, 110)}`;
  if (o.kind === "failed") return `FAILED: ${o.reason.slice(0, 110)}`;
  return o.kind;
}

async function main(): Promise<void> {
  const models = (flag("model") ?? "deepseek/deepseek-v4-flash-0731").split(",");
  const only = flag("only")?.split(",");
  const reasoning = (flag("reasoning") ?? "none") as ReasoningEffort;
  const outDir = resolve(flag("out") ?? "ask-eval-out");
  const webSearch = process.argv.includes("--web");
  const cases = ASK_CASES.filter((c) => !only || only.includes(c.id));
  let total = 0;
  for (const model of models) {
    for (const c of cases) {
      const r = await runCase(model, c, reasoning, outDir, webSearch);
      total += r.cost;
      console.log(`${model.padEnd(34)} ${c.id.padEnd(26)} ${r.secs.toFixed(1).padStart(5)}s ${r.turns}t $${r.cost.toFixed(4)}  ${describe(r.outcome)}`);
    }
  }
  console.log(`\ntotal $${total.toFixed(4)} — transcripts in ${outDir}`);
}

void main();
