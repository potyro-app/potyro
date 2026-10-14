// Run a prompt corpus through a model and score every result, writing artifacts for BOTH
// judgements: the automated gates (compiles/validates/renders) and a human review sheet, because
// the harness cannot tell whether the app is the app the person asked for.
//
//   pnpm --filter @potyro/generator eval:cli -- --corpus wild --concurrency 4
//   OPENROUTER_API_KEY=sk-or-… pnpm --filter @potyro/generator eval:cli -- \
//     --backend openrouter --model deepseek/deepseek-v4-flash-0731 --corpus wild
//
// Flags: --backend claude-cli|openrouter  --model <alias|openrouter model id>
//        --reasoning none|minimal|low|medium|high   (openrouter; default none — reasoning tokens
//                                                    come out of the same budget as the answer and
//                                                    their size is wildly unpredictable, see
//                                                    DEFAULT_REASONING in openrouter-backend.ts)
//        --corpus wild|core|both  --limit N  --concurrency N  --repairs N
//        --only id1,id2           --out <dir>
//        --language pl|pt-BR      (#301) each prompt is its hand-checked translation (translated-cases.ts),
//                                 the turn carries the language line, and the report adds whether the
//                                 app's labels are in that language. `en` is today's run, unchanged.
//        --backend scripted       no model: a small app whose words follow the language line the turn
//                                 carried — proves the language column without a key
//
// Every backend is handed the same contract and the same turns (prompt.ts / chat-backend.ts), so
// one run's report.json is directly comparable to another's.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ClaudeCliBackend } from "../src/cli-backend.js";
import { createOpenRouterBackend, type ReasoningEffort } from "../src/openrouter-backend.js";
import { PROMPTS } from "../src/prompts.js";
import { WILD_PROMPTS, type WildPrompt } from "../src/wild-prompts.js";
import { loadApp, scoreSource, type ScoreResult } from "../src/score.js";
import { smokeApp, smokePassed, type SmokeResult } from "../src/smoke.js";
import type { GenPrompt, ModelBackend } from "../src/backend.js";
import { buildUserMessage } from "../src/prompt.js";
import { LANGUAGE_NAMES, matchLanguage, type Language } from "../src/language.js";
import { EVAL_LANGUAGES, isEvalLanguage, localizeCreatePrompt } from "../src/translated-cases.js";
import { checkLabels, newLabels, summarizeLanguage, type LabelCheck } from "../src/language-eval.js";
import { rate } from "../src/loop-eval.js";

interface Outcome {
  prompt: GenPrompt;
  corpus: "wild" | "core";
  singlePass: ScoreResult;
  repairsUsed: number;
  final: ScoreResult;
  /** Deep gate: does the app's own logic actually run? Null when it never validated. */
  smoke: SmokeResult | null;
  works: boolean;
  /** `--language` only (#301): are the app's labels in the person's language? */
  labels?: LabelCheck;
  source: string;
  file: string;
  ms: number;
  crashed?: string;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Bounded-concurrency map that preserves input order. */
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

/** What the scripted backend's app says, by the language's English name as the create turn says it. */
const SCRIPTED_WORDS: Readonly<Record<string, { app: string; entity: string; title: string; done: string; page: string }>> = {
  English: { app: "My notes", entity: "Note", title: "Title", done: "Done", page: "All my notes" },
  Polish: { app: "Moje notatki", entity: "Notatka", title: "Tytuł", done: "Zrobione", page: "Wszystkie notatki" },
  "Brazilian Portuguese": { app: "Minhas anotações", entity: "Anotação", title: "Título", done: "Concluído", page: "Todas as minhas anotações" },
};

/**
 * No model: one small app per prompt, in the language the TURN asked for — read from the message the
 * backends send (`buildUserMessage`), not from the prompt object, so a language that never reached
 * the turn comes back English and the column says so.
 */
function scriptedCreateBackend(): ModelBackend {
  return {
    name: "scripted:create",
    async generate(prompt: GenPrompt) {
      const said = /the person speaks ([A-Z][a-z]+(?: [A-Z][a-z]+)?)\./.exec(buildUserMessage(prompt))?.[1] ?? "English";
      const w = SCRIPTED_WORDS[said] ?? SCRIPTED_WORDS.English!;
      return `import { defineApp } from "potyro";
export default defineApp({
  id: "${prompt.id}", name: "${w.app}", version: "1.0.0", schemaVersion: 1,
  entities: { note: { label: "${w.entity}", displayField: "title", fields: { title: { type: "text", label: "${w.title}", required: true }, done: { type: "boolean", label: "${w.done}", default: false } } } },
  pages: [{ id: "all", title: "${w.page}", view: { type: "list", entity: "note", display: { primary: "title" } } }],
});`;
    },
  };
}

/** Which model answers the corpus. Everything downstream reads only the `ModelBackend` contract. */
async function makeBackend(kind: string, model: string | undefined, reasoning: string | undefined): Promise<ModelBackend> {
  if (kind === "scripted") return scriptedCreateBackend();
  if (kind === "claude-cli") return new ClaudeCliBackend({ ...(model ? { model } : {}) });
  // Throws up-front on a missing OPENROUTER_API_KEY rather than 401-ing partway through the corpus.
  if (kind === "openrouter") {
    return createOpenRouterBackend({
      ...(model ? { model } : {}),
      ...(reasoning ? { reasoning: { effort: reasoning as ReasoningEffort, exclude: true } } : {}),
    });
  }
  throw new Error(`unknown --backend "${kind}" (expected claude-cli, openrouter or scripted)`);
}

async function main(): Promise<void> {
  const corpus = (arg("corpus", "wild") ?? "wild") as "wild" | "core" | "both";
  const limit = Number(arg("limit", "0"));
  const concurrency = Number(arg("concurrency", "4"));
  const maxRepairs = Number(arg("repairs", "2"));
  const model = arg("model");
  const only = arg("only")?.split(",").map((s) => s.trim());
  const outDir = resolve(arg("out", join(process.cwd(), "eval-out", `run-${Date.now()}`))!);

  const tagged: Array<{ prompt: GenPrompt; corpus: "wild" | "core" }> = [
    ...(corpus !== "core" ? WILD_PROMPTS.map((p) => ({ prompt: p as GenPrompt, corpus: "wild" as const })) : []),
    ...(corpus !== "wild" ? PROMPTS.map((p) => ({ prompt: p, corpus: "core" as const })) : []),
  ];
  // #301: the person's language. English (or no flag) is today's run, byte for byte.
  const languageArg = arg("language");
  const language: Language | null = languageArg ? matchLanguage(languageArg) : null;
  if (languageArg && !language) throw new Error(`--language ${languageArg}: not a language Potyro speaks`);
  if (language && language !== "en" && !isEvalLanguage(language)) throw new Error(`--language ${language}: the corpus has hand-checked requests only in ${EVAL_LANGUAGES.join(", ")}`);
  const localized = language && isEvalLanguage(language) ? tagged.map((t) => ({ ...t, prompt: localizeCreatePrompt(t.prompt, language) })) : tagged;
  let selected = only ? localized.filter((t) => only.includes(t.prompt.id)) : localized;
  if (limit > 0) selected = selected.slice(0, limit);

  mkdirSync(outDir, { recursive: true });
  const backend = await makeBackend(arg("backend", "claude-cli") ?? "claude-cli", model, arg("reasoning"));
  console.log(`backend=${backend.name} corpus=${corpus} n=${selected.length} concurrency=${concurrency} repairs=${maxRepairs}${language ? ` language=${language}` : ""}`);
  console.log(`out=${outDir}\n`);

  let done = 0;
  const outcomes = await pool(selected, concurrency, async ({ prompt, corpus: c }) => {
    const started = Date.now();
    const file = join(outDir, `${prompt.id}.app.ts`);
    try {
      let source = await backend.generate(prompt);
      const singlePass = await scoreSource(source);
      let final = singlePass;
      let repairsUsed = 0;
      while (!final.validates && repairsUsed < maxRepairs && backend.repair) {
        source = await backend.repair(source, final.errors, prompt);
        repairsUsed += 1;
        final = await scoreSource(source);
      }
      writeFileSync(file, source);

      // Deep gate — only meaningful once the app validates.
      let smoke: SmokeResult | null = null;
      if (final.validates) {
        try {
          smoke = await smokeApp((await loadApp(source)) as never);
        } catch (e) {
          smoke = null;
          final.errors.push(`smoke-harness: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const works = Boolean(smoke && smokePassed(smoke));
      const labels = language ? checkLabels(newLabels(source), language) : undefined;

      const o: Outcome = { prompt, corpus: c, singlePass, repairsUsed, final, smoke, works, ...(labels ? { labels } : {}), source, file, ms: Date.now() - started };
      const mark = works ? "✓" : final.renders ? "~" : "✗";
      const why = works ? "" : ` — ${(smoke?.errors[0] ?? final.errors[0] ?? "").split("\n")[0].slice(0, 70)}`;
      const lang = labels ? ` · labels ${labels.passed === null ? "—" : labels.passed ? "ok" : `NOT ${LANGUAGE_NAMES[labels.expected]}: ${labels.offenders.join(", ")}`}` : "";
      console.log(`${mark} [${++done}/${selected.length}] ${prompt.id} (repairs=${repairsUsed}, ${Math.round(o.ms / 1000)}s)${why}${lang}`);
      return o;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`! [${++done}/${selected.length}] ${prompt.id} CRASHED: ${msg.slice(0, 120)}`);
      const dead: ScoreResult = { compiles: false, validates: false, renders: false, errors: [`harness: ${msg}`] };
      return { prompt, corpus: c, singlePass: dead, repairsUsed: 0, final: dead, smoke: null, works: false, source: "", file, ms: Date.now() - started, crashed: msg };
    }
  });

  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
  const summarise = (rows: Outcome[]) => ({
    n: rows.length,
    singlePassValid: rows.filter((o) => o.singlePass.validates).length,
    validWithinN: rows.filter((o) => o.final.validates).length,
    renders: rows.filter((o) => o.final.renders).length,
    works: rows.filter((o) => o.works).length,
    ...(language ? { language: summarizeLanguage(rows.map((o) => ({ labels: o.labels ?? null }))) } : {}),
  });

  const groups = [
    ["wild", outcomes.filter((o) => o.corpus === "wild")],
    ["core", outcomes.filter((o) => o.corpus === "core")],
  ] as const;

  const lines: string[] = ["", "=".repeat(60)];
  for (const [name, rows] of groups) {
    if (!rows.length) continue;
    const s = summarise(rows);
    lines.push(
      `${name.toUpperCase()} corpus (n=${s.n}, maxRepairs=${maxRepairs})`,
      `  single-pass valid: ${s.singlePassValid}/${s.n} (${pct(s.singlePassValid, s.n)})`,
      `  valid ≤${maxRepairs} repairs: ${s.validWithinN}/${s.n} (${pct(s.validWithinN, s.n)})`,
      `  renders:           ${s.renders}/${s.n} (${pct(s.renders, s.n)})`,
      `  WORKS (smoke):     ${s.works}/${s.n} (${pct(s.works, s.n)})   ← logic actually runs`,
      ...(s.language && language
        ? [
            `  labels in ${LANGUAGE_NAMES[language]}: ${rate(s.language.labelsPassed, s.language.labelsChecked)} of apps with a label it could read` +
              ` (${s.language.labels.inExpected} labels in it, ${s.language.labels.inOther} in another, ${s.language.labels.unknown} too short to tell)`,
          ]
        : []),
      "",
    );
  }
  console.log(lines.join("\n"));

  writeFileSync(
    join(outDir, "report.json"),
    JSON.stringify(
      {
        backend: backend.name,
        maxRepairs,
        ...(language ? { language } : {}),
        generatedAt: new Date().toISOString(),
        summary: Object.fromEntries(groups.filter(([, r]) => r.length).map(([n, r]) => [n, summarise(r)])),
        outcomes: outcomes.map(({ source: _s, ...rest }) => rest),
      },
      null,
      2,
    ),
  );

  // Human review sheet. The automated gates say the app RUNS; only a person can say it is the app
  // that was asked for — so every row gets a blank score even when the gates are green.
  const review: string[] = [
    "# Review sheet — is it the app they asked for?",
    "",
    `Backend: \`${backend.name}\` · maxRepairs: ${maxRepairs} · generated ${new Date().toISOString()}`,
    "",
    "Score each 0–3, replacing the `_` on the **Human** line:",
    "",
    "| Score | Meaning |",
    "|---|---|",
    "| 0 | Doesn't run, or is a different app than asked for |",
    "| 1 | Runs, but misses the point — I couldn't use it for this |",
    "| 2 | Usable. Roughly what I asked for, with gaps |",
    "| 3 | Genuinely good. I would actually use this |",
    "",
    "The automated verdict only covers compiles/validates/renders. A ✓ app can still score 0.",
    "",
    "---",
    "",
  ];
  for (const o of outcomes) {
    const gate = o.works
      ? "✓ works — validates, renders, and its own logic runs"
      : o.final.renders
        ? "~ renders but its logic throws when exercised"
        : o.final.validates
          ? "~ validates but does not render"
          : "✗ invalid";
    const w = o.prompt as WildPrompt;
    review.push(
      `## ${o.prompt.id}  (${o.corpus})`,
      "",
      `> ${o.prompt.description}`,
      "",
      `- **Automated:** ${gate} · repairs used: ${o.repairsUsed}`,
      ...(w.risk ? [`- **Suspected gap:** ${w.risk}`] : []),
      ...(o.smoke?.errors.length ? [`- **Runtime errors:** ${o.smoke.errors.slice(0, 4).map((e) => e.split("\n")[0]).join(" · ")}`] : []),
      ...(o.final.errors.length ? [`- **Errors:** ${o.final.errors.map((e) => e.split("\n")[0]).join(" · ")}`] : []),
      `- **Source:** \`${o.file.replace(process.cwd() + "/", "")}\``,
      "- **Human:** `_`  —",
      "",
    );
  }
  writeFileSync(join(outDir, "REVIEW.md"), review.join("\n"));
  console.log(`report.json + REVIEW.md written to ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
