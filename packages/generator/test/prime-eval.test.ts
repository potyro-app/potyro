// Priming in Polish and Brazilian Portuguese, against the real corpus and the hand-checked requests
// (prime-eval.ts). Floors, not targets: they sit under what was measured, so a change that makes
// another language prime worse fails here, free, before any paid run.
//
// What the floors hold changed on 2026-10-31. They held `shared` — of English's two primed passages,
// how many the translated request primes too — measured on a 32-file corpus at 2026-10-14: modify pl
// 26/50, pt-BR 18/50; create pl 34/96, pt-BR 32/96. On main's 139-file corpus that figure stopped
// measuring the language:
//   - the corpus has 3.6× the passages (~2,330 against ~640, 17 apps more), so English's top two come
//     from many close scores, and which of several near equals ranks first is partly chance;
//   - English itself primes translation tables (an app's words.ts) for some requests, a pick no other
//     language should copy;
//   - the same code on the old 32 files still gives modify pl 29/50 (58%), pt-BR 24/50.
// The floors now hold `nearEnglish`: of the translated request's two passages, how many are among
// English's best five — whether it lands where English would look. 2026-10-31, today's code:
//   nearEnglish   modify pl 27/50 (54%), pt-BR 28/50 (56%); create pl 74/120 (62%), pt-BR 63/120 (53%)
//                 (old 32-file corpus: modify 68% / 70%, create 57% / 63%)
//   shared        modify pl 18/50 (36%), pt-BR 21/50 (42%); create pl 52/120 (43%), pt-BR 36/120 (30%)
//                 (before the PR #320 fixes for this corpus: 7/50, 6/50, 15/120, 7/120)
// `shared` is still computed and printed (here and by eval:prime), never asserted.

import { describe, expect, it } from "vitest";
import { CORPUS } from "../src/corpus.generated.js";
import { primeGroups } from "../src/corpus.js";
import { MODIFY_CASES } from "../src/modify-corpus.js";
import { WILD_PROMPTS } from "../src/wild-prompts.js";
import { PROMPTS } from "../src/prompts.js";
import { CREATE_REQUESTS, EVAL_LANGUAGES, MODIFY_REQUESTS } from "../src/translated-cases.js";
import { formatParity, primeParity, primedFiles, type PrimeCase } from "../src/prime-eval.js";
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

describe("priming in other languages (#306 follow-up)", () => {
  it("primes every modify request in every language, where English would look", () => {
    const p = primeParity(CORPUS, modify, EVAL_LANGUAGES);
    console.log(formatParity("modify", p, EVAL_LANGUAGES));
    expect(p.primed).toEqual({ en: modify.length, pl: modify.length, "pt-BR": modify.length });
    // Measured 2026-10-31: pl 54%, pt-BR 56%.
    expect(p.nearEnglish.pl / p.passages.pl).toBeGreaterThanOrEqual(0.5);
    expect(p.nearEnglish["pt-BR"] / p.passages["pt-BR"]).toBeGreaterThanOrEqual(0.5);
  });

  it("primes the create prompts in every language, where English would look", () => {
    const p = primeParity(CORPUS, create, EVAL_LANGUAGES);
    console.log(formatParity("create", p, EVAL_LANGUAGES));
    expect(p.primed.pl).toBeGreaterThanOrEqual(create.length - 2);
    expect(p.primed["pt-BR"]).toBe(create.length);
    // Measured 2026-10-31: pl 62%, pt-BR 53%.
    expect(p.nearEnglish.pl / p.passages.pl).toBeGreaterThanOrEqual(0.5);
    expect(p.nearEnglish["pt-BR"] / p.passages["pt-BR"]).toBeGreaterThanOrEqual(0.5);
  });

  it("leaves every English request's words as they are, so English primes as it did", () => {
    for (const c of [...modify, ...create]) {
      for (const language of ["en", undefined] as const) {
        expect(primeGroups(CORPUS, c.en, c.source, language).every((g) => g.length === 1), c.id).toBe(true);
      }
    }
  });

  it("reads the files a primed message quotes", () => {
    expect(primedFiles("intro\n--- examples/a.app.ts:1-30\nx\n--- docs/04.md:31-60\ny\n")).toEqual(["examples/a.app.ts", "docs/04.md"]);
  });
});
