// Does a request in another language prime the model with what the English one does? (#306 follow-up)
//
// No model, no money: `primeCorpus` is deterministic, so the same request in English and in its
// hand-checked translation (translated-cases.ts) can be compared directly. The English passages are
// the yardstick — not because they are always right, but because a request means the same in every
// language, so what it is primed with should not depend on which one it was typed in.
//
// Two measures. `shared`: of English's two passages, how many the translated request primes too —
// strict, and on a corpus of thousands of close-scoring passages much of it is which of several near
// equals came first. `nearEnglish`: of the translated request's two passages, how many are among
// English's best five — whether it lands where English would look. The floors hold the second
// (test/prime-eval.test.ts says why); both are printed.

import { primeCorpus, primeRankedFiles, type Corpus } from "./corpus.js";
import type { EvalLanguage } from "./translated-cases.js";

export interface PrimeCase {
  id: string;
  /** The request in English. */
  en: string;
  /** The same request, by language. */
  translated: Partial<Record<EvalLanguage, string>>;
  /** The app being changed; empty for a new app. */
  source: string;
}

export interface PrimeParity {
  cases: number;
  /** How many cases primed any passage, per language. */
  primed: Record<"en" | EvalLanguage, number>;
  /** English's passages over every case. */
  enPassages: number;
  /** Of those, how many the translated request primed too (same file). */
  shared: Record<EvalLanguage, number>;
  /** How many passages the translated request primed, over every case. */
  passages: Record<EvalLanguage, number>;
  /** Of those, how many are among English's best `NEAR` (same file). */
  nearEnglish: Record<EvalLanguage, number>;
  /** Per case, the files each language primed: what to read when a number moves. */
  rows: Array<{ id: string } & Partial<Record<"en" | EvalLanguage, string[]>>>;
}

/** The files a primed message quotes, in order. */
export const primedFiles = (primed: string): string[] => [...primed.matchAll(/^--- (\S+?):\d+-\d+$/gm)].map((m) => m[1]!);

/** How far down English's ranking a translated request's passage may be and still be where English looks. */
export const NEAR = 5;

export function primeParity(corpus: Corpus, cases: readonly PrimeCase[], languages: readonly EvalLanguage[]): PrimeParity {
  const out: PrimeParity = {
    cases: cases.length,
    primed: { en: 0, ...Object.fromEntries(languages.map((l) => [l, 0])) } as PrimeParity["primed"],
    enPassages: 0,
    shared: Object.fromEntries(languages.map((l) => [l, 0])) as PrimeParity["shared"],
    passages: Object.fromEntries(languages.map((l) => [l, 0])) as PrimeParity["passages"],
    nearEnglish: Object.fromEntries(languages.map((l) => [l, 0])) as PrimeParity["nearEnglish"],
    rows: [],
  };
  for (const c of cases) {
    const en = primedFiles(primeCorpus(corpus, c.en, c.source, "en"));
    const near = primeRankedFiles(corpus, c.en, c.source, "en", NEAR);
    const row: PrimeParity["rows"][number] = { id: c.id, en };
    if (en.length) out.primed.en++;
    out.enPassages += en.length;
    for (const l of languages) {
      const text = c.translated[l];
      if (!text) continue;
      const files = primedFiles(primeCorpus(corpus, text, c.source, l));
      row[l] = files;
      if (files.length) out.primed[l]++;
      out.shared[l] += en.filter((f) => files.includes(f)).length;
      out.passages[l] += files.length;
      out.nearEnglish[l] += files.filter((f) => near.includes(f)).length;
    }
    out.rows.push(row);
  }
  return out;
}

export function formatParity(name: string, p: PrimeParity, languages: readonly EvalLanguage[]): string {
  const lines = [`${name}: ${p.cases} requests; primed — en ${p.primed.en}${languages.map((l) => `, ${l} ${p.primed[l]}`).join("")}`];
  const of = (n: number, d: number): string => `${n}/${d} (${d ? Math.round((100 * n) / d) : 0}%)`;
  for (const l of languages) {
    lines.push(`  ${l}: within English's top ${NEAR} ${of(p.nearEnglish[l], p.passages[l])}; shares English's top 2 ${of(p.shared[l], p.enPassages)}`);
  }
  return lines.join("\n");
}
