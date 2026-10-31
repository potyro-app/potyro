// Corpus priming in other languages, measured without a model (prime-eval.ts):
//
//   pnpm --filter @potyro/generator eval:prime            # the summary
//   pnpm --filter @potyro/generator eval:prime -- --rows  # and every request's primed files
//
// Free and deterministic. Every modify case and every create prompt, in English and in each
// hand-checked translation (translated-cases.ts), against the release's corpus.

import { MODIFY_CASES } from "../src/modify-corpus.js";
import { WILD_PROMPTS } from "../src/wild-prompts.js";
import { PROMPTS } from "../src/prompts.js";
import { CORPUS } from "../src/corpus.generated.js";
import { CREATE_REQUESTS, EVAL_LANGUAGES, MODIFY_REQUESTS } from "../src/translated-cases.js";
import { formatParity, primeParity, type PrimeCase } from "../src/prime-eval.js";
import { caseSource } from "../src/prime-eval-cases.js";

const modify: PrimeCase[] = MODIFY_CASES.map((c) => ({
  id: c.id,
  en: c.instruction,
  translated: Object.fromEntries(EVAL_LANGUAGES.map((l) => [l, MODIFY_REQUESTS[l][c.id]])),
  source: caseSource(c.app),
}));
const create: PrimeCase[] = [...WILD_PROMPTS, ...PROMPTS].map((p) => ({
  id: p.id,
  en: p.description,
  translated: Object.fromEntries(EVAL_LANGUAGES.map((l) => [l, CREATE_REQUESTS[l][p.id]])),
  source: "",
}));

const rows = process.argv.includes("--rows");
for (const [name, cases] of [["modify", modify], ["create", create]] as const) {
  const p = primeParity(CORPUS, cases, EVAL_LANGUAGES);
  console.log(formatParity(name, p, EVAL_LANGUAGES));
  if (rows) for (const r of p.rows) console.log(`  ${r.id}\n${(["en", ...EVAL_LANGUAGES] as const).map((l) => `    ${l}: ${(r[l] ?? []).join(", ")}`).join("\n")}`);
}
