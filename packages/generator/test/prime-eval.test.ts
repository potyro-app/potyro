// Priming in Polish and Brazilian Portuguese, against the real corpus and the hand-checked requests
// (prime-eval.ts). Floors, not targets: they sit under what the build measured, so a change that
// makes another language prime worse fails here, free, before any paid run.

import { describe, expect, it } from "vitest";
import { CORPUS } from "../src/corpus.generated.js";
import { primeGroups } from "../src/corpus.js";
import { MODIFY_CASES } from "../src/modify-corpus.js";
import { WILD_PROMPTS } from "../src/wild-prompts.js";
import { PROMPTS } from "../src/prompts.js";
import { CREATE_REQUESTS, EVAL_LANGUAGES, MODIFY_REQUESTS } from "../src/translated-cases.js";
import { primeParity, primedFiles, type PrimeCase } from "../src/prime-eval.js";
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
  it("primes every modify request in every language, sharing much of what English primes", () => {
    const p = primeParity(CORPUS, modify, EVAL_LANGUAGES);
    expect(p.primed).toEqual({ en: modify.length, pl: modify.length, "pt-BR": modify.length });
    // Measured at build (32-file corpus): pl 26/50, pt-BR 18/50 (before: 9 and 11). On main's 139 files,
    // 2026-10-31: pl 18/50, pt-BR 21/50; the pl floor fails (see PR #320: the yardstick moved).
    expect(p.shared.pl / p.enPassages).toBeGreaterThanOrEqual(0.45);
    expect(p.shared["pt-BR"] / p.enPassages).toBeGreaterThanOrEqual(0.3);
  });

  it("primes the create prompts in every language, sharing a third of what English primes", () => {
    const p = primeParity(CORPUS, create, EVAL_LANGUAGES);
    expect(p.primed.pl).toBeGreaterThanOrEqual(create.length - 2);
    expect(p.primed["pt-BR"]).toBe(create.length);
    // Measured at build: pl 34/96, pt-BR 32/96 (before: 25 and 18). 2026-10-31, 60 prompts: pl 52/120, pt-BR 36/120.
    expect(p.shared.pl / p.enPassages).toBeGreaterThanOrEqual(0.3);
    expect(p.shared["pt-BR"] / p.enPassages).toBeGreaterThanOrEqual(0.3);
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
