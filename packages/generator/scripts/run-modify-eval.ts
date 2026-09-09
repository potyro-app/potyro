// Measure how a model behaves when asked to CHANGE an app rather than write one.
//
//   OPENROUTER_API_KEY=sk-or-… pnpm --filter @karta/generator eval:modify -- --backend openrouter
//   pnpm --filter @karta/generator eval:modify -- --backend openrouter --model deepseek/deepseek-v4-pro-0813
//   pnpm --filter @karta/generator eval:modify -- --backend scripted        # no key: proves the harness
//
// Flags: --backend openrouter|claude-cli|scripted  --model <id>  --reasoning <effort>
//        --only id1,id2  --concurrency N  --out <dir>
//
// Every case runs through the SAME guard the Studio uses (`guardedModify`): one attempt, and if it
// dropped an entity or page, one retry with the loss named. So the numbers here are the numbers a
// person sees, and the two rates that matter fall straight out:
//
//   rewrote (1st)   how often the model's first reply replaced the app  - the raw model behaviour
//   rewrote (final) how often it STILL had after the retry              - what reaches the editor
//
// plus LANDED (the change is present) and VALIDATES (the result is a well-formed app), so a model
// that keeps the app by ignoring the request does not score as a win.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ClaudeCliBackend } from "../src/cli-backend.js";
import { createOpenRouterBackend, type ReasoningEffort } from "../src/openrouter-backend.js";
import { guardedModify } from "../src/guarded-modify.js";
import { MODIFY_CASES, type DefinitionShape, type ModifyCase } from "../src/modify-corpus.js";
import { loadApp, scoreSource } from "../src/score.js";
import { NOT_IN_APP } from "../src/prompt.js";
import type { GenPrompt, ModelBackend } from "../src/backend.js";
import type { AppShape } from "@karta/runtime";

interface Outcome {
  id: string;
  app: string;
  /** The first reply dropped an entity or a page - the raw behaviour this eval exists to count. */
  rewroteFirst: boolean;
  /** What reached the editor still drops something, even after the retry. */
  rewroteFinal: boolean;
  loss: string | null;
  /** null = the case has no structural predicate (keep-only); it is excluded from the landed rate. */
  landed: boolean | null;
  validates: boolean;
  /** The model answered NOT-IN-APP instead of source: it judged the request not to be the app's to
   *  fulfil. A legitimate outcome, scored on its own - NOT as "invalid", which is what it looked
   *  like on the first real run (a 3-second "app" that was actually one line of prose). */
  declined: boolean;
  ms: number;
  crashed?: string;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Bounded-concurrency map that preserves input order (same shape as run-cli-eval). */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

/**
 * A backend with no model behind it, whose first modify REPLACES the app and whose retry hands the
 * original back untouched. It exists so the harness can be proven end to end without a key: it
 * must report rewroteFirst=true, rewroteFinal=false, landed=false for every case. If it does not,
 * the harness is broken, not the model.
 */
function scriptedBackend(): ModelBackend {
  const calls = new Map<string, number>();
  return {
    name: "scripted:rewrite-then-restore",
    async generate() {
      throw new Error("scripted backend only modifies");
    },
    async modify(source: string, instruction: string) {
      // The retry carries a DIFFERENT instruction (the loss is appended after a blank line), so key
      // on the original request - the text before that blank line - plus the source, not on the
      // full instruction. Keying on the full text made the fake rewrite twice and looked, correctly,
      // like "retry did not help" - a harness bug the scripted run exists to catch.
      const key = `${source.length}:${instruction.split("\n\n")[0]}`;
      const n = (calls.get(key) ?? 0) + 1;
      calls.set(key, n);
      if (n > 1) return source;
      // A different, smaller app: one entity, one page. Exactly what a rewrite looks like.
      return `import { defineApp } from "karta";
export default defineApp({
  id: "rewritten", name: "Rewritten", version: "1.0.0", schemaVersion: 1,
  entities: { thing: { label: "Thing", displayField: "name", fields: { name: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Things", view: { type: "list", entity: "thing", display: { primary: "name" } } }],
});`;
    },
  };
}

async function makeBackend(kind: string, model: string | undefined, reasoning: string | undefined): Promise<ModelBackend> {
  if (kind === "scripted") return scriptedBackend();
  if (kind === "claude-cli") return new ClaudeCliBackend({ ...(model ? { model } : {}) });
  if (kind === "openrouter") {
    return createOpenRouterBackend({
      ...(model ? { model } : {}),
      ...(reasoning ? { reasoning: { effort: reasoning as ReasoningEffort, exclude: true } } : {}),
    });
  }
  throw new Error(`unknown --backend "${kind}" (expected openrouter, claude-cli or scripted)`);
}

/** The shape the guard compares, from a loaded app. Throws when the source does not load, which
 *  `guardedModify` treats as "cannot judge" rather than a loss. */
async function shapeOf(source: string, resolveDir: string): Promise<AppShape & DefinitionShape> {
  const app = (await loadApp(source, resolveDir)) as unknown as DefinitionShape;
  return { entities: app.entities, pages: app.pages as AppShape["pages"] & DefinitionShape["pages"] };
}

async function runCase(backend: ModelBackend, c: ModifyCase, examplesDir: string, outDir: string): Promise<Outcome> {
  const started = Date.now();
  const source = readFileSync(join(examplesDir, `${c.app}.app.ts`), "utf8");
  // Every reply the model gives is written out, or a failed case cannot be diagnosed - the first
  // real run left two "did not land" and two "invalid" rows with nothing to look at.
  let turn = 0;
  const keep = (text: string): string => {
    turn += 1;
    writeFileSync(join(outDir, `${c.id}.attempt-${turn}.app.ts`), text);
    return text;
  };
  const p: GenPrompt = { id: c.id, description: c.instruction };
  try {
    if (!backend.modify) throw new Error(`${backend.name} has no modify()`);
    // Bundle from the examples dir so an app's own `./views/…` imports resolve - the examples are
    // real apps with real custom views, which is exactly why they are worth measuring against.
    const before = await shapeOf(source, examplesDir);
    // A predicate that is already true on the UNMODIFIED app proves nothing about the change - it
    // would score "landed" for a model that ignored the request. The scripted run caught five of
    // these on the first draft of the corpus. Refuse the case rather than report a number that lies.
    if (c.landed && c.landed(before)) {
      throw new Error(`corpus bug: "${c.id}" says landed on the ORIGINAL app - its predicate (${c.expects}) is vacuous`);
    }
    const result = await guardedModify({
      attempt: async (instr) => keep(await backend.modify!(source, instr, p)),
      shapeOf: (src) => shapeOf(src, examplesDir),
      before,
      instruction: c.instruction,
    });
    const declined = result.source.trimStart().startsWith(NOT_IN_APP);
    let landed: boolean | null = c.landed ? false : null;
    let validates = false;
    if (!declined) try {
      const final = await shapeOf(result.source, examplesDir);
      if (c.landed) landed = c.landed(final);
      validates = (await scoreSource(result.source, examplesDir)).validates;
    } catch {
      // Does not load: neither landed nor valid, and `loss` is whatever the guard could tell.
    }
    return {
      id: c.id,
      app: c.app,
      rewroteFirst: result.retried,
      rewroteFinal: result.loss !== null,
      loss: result.loss,
      landed: declined ? null : landed,
      validates,
      declined,
      ms: Date.now() - started,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { id: c.id, app: c.app, rewroteFirst: false, rewroteFinal: false, loss: null, landed: false, validates: false, declined: false, ms: Date.now() - started, crashed: msg };
  }
}

async function main(): Promise<void> {
  const only = arg("only")?.split(",").map((s) => s.trim());
  const concurrency = Number(arg("concurrency", "3"));
  const outDir = resolve(arg("out", join(process.cwd(), "eval-out", `modify-${Date.now()}`))!);
  const examplesDir = resolve(process.cwd(), "..", "..", "examples");
  const cases = only ? MODIFY_CASES.filter((c) => only.includes(c.id)) : [...MODIFY_CASES];

  mkdirSync(outDir, { recursive: true });
  const backend = await makeBackend(arg("backend", "openrouter") ?? "openrouter", arg("model"), arg("reasoning"));
  console.log(`backend=${backend.name} cases=${cases.length} concurrency=${concurrency}\nout=${outDir}\n`);

  let done = 0;
  const outcomes = await pool(cases, concurrency, async (c) => {
    const o = await runCase(backend, c, examplesDir, outDir);
    const mark = o.crashed ? "!" : o.rewroteFinal ? "✗" : o.declined ? "∅" : o.landed ? "✓" : "~";
    const note = o.crashed ? ` CRASHED: ${o.crashed.slice(0, 80)}` : o.rewroteFirst ? (o.rewroteFinal ? ` rewrote, retry did not help: ${o.loss}` : " rewrote, retry kept the app") : "";
    console.log(`${mark} [${++done}/${cases.length}] ${o.id} (${Math.round(o.ms / 1000)}s)${o.declined ? " — declined (NOT-IN-APP)" : o.landed === false ? " — did not land" : ""}${note}`);
    return o;
  });

  const n = outcomes.length;
  const count = (f: (o: Outcome) => boolean) => outcomes.filter(f).length;
  const pct = (k: number) => (n ? `${Math.round((k / n) * 100)}%` : "—");
  const summary = {
    backend: backend.name,
    n,
    rewroteFirst: count((o) => o.rewroteFirst),
    rewroteFinal: count((o) => o.rewroteFinal),
    landed: count((o) => o.landed === true),
    landable: count((o) => o.landed !== null),
    validates: count((o) => o.validates),
    declined: count((o) => o.declined),
    crashed: count((o) => Boolean(o.crashed)),
  };
  const lines = [
    "",
    "=".repeat(60),
    `MODIFY — ${backend.name} (n=${n})`,
    `  rewrote on 1st attempt:   ${summary.rewroteFirst}/${n} (${pct(summary.rewroteFirst)})   ← raw model behaviour`,
    `  still rewrote after retry: ${summary.rewroteFinal}/${n} (${pct(summary.rewroteFinal)})   ← what reaches the editor`,
    `  change landed:            ${summary.landed}/${summary.landable} (${summary.landable ? Math.round((summary.landed / summary.landable) * 100) : 0}%)   ← of cases with a structural check`,
    `  result validates:         ${summary.validates}/${n} (${pct(summary.validates)})`,
    summary.declined ? `  declined (NOT-IN-APP):    ${summary.declined}/${n}   ← judged not the app's to change; excluded from landed` : "",
    summary.crashed ? `  crashed:                  ${summary.crashed}/${n}` : "",
    "=".repeat(60),
  ].filter((l) => l !== "");
  console.log(lines.join("\n"));

  writeFileSync(join(outDir, "report.json"), JSON.stringify({ summary, outcomes }, null, 2));
  console.log(`\nreport: ${join(outDir, "report.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
