// Does a request in another language prime the model with what the English one does? (#306 follow-up)
//
// No model, no money: `primeCorpus` is deterministic, so the same request in English and in its
// hand-checked translation (translated-cases.ts) can be compared directly. The English passages are
// the yardstick — not because they are always right, but because a request means the same in every
// language, so what it is primed with should not depend on which one it was typed in.

import { primeCorpus, type Corpus } from "./corpus.js";
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
  /** Per case, the files each language primed: what to read when a number moves. */
  rows: Array<{ id: string } & Partial<Record<"en" | EvalLanguage, string[]>>>;
}

/** The files a primed message quotes, in order. */
export const primedFiles = (primed: string): string[] => [...primed.matchAll(/^--- (\S+?):\d+-\d+$/gm)].map((m) => m[1]!);

export function primeParity(corpus: Corpus, cases: readonly PrimeCase[], languages: readonly EvalLanguage[]): PrimeParity {
  const out: PrimeParity = {
    cases: cases.length,
    primed: { en: 0, ...Object.fromEntries(languages.map((l) => [l, 0])) } as PrimeParity["primed"],
    enPassages: 0,
    shared: Object.fromEntries(languages.map((l) => [l, 0])) as PrimeParity["shared"],
    rows: [],
  };
  for (const c of cases) {
    const en = primedFiles(primeCorpus(corpus, c.en, c.source, "en"));
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
    }
    out.rows.push(row);
  }
  return out;
}

export function formatParity(name: string, p: PrimeParity, languages: readonly EvalLanguage[]): string {
  const pct = (n: number): string => (p.enPassages ? `${Math.round((100 * n) / p.enPassages)}%` : "–");
  const lines = [`${name}: ${p.cases} requests; primed — en ${p.primed.en}${languages.map((l) => `, ${l} ${p.primed[l]}`).join("")}`];
  for (const l of languages) lines.push(`  ${l} primes ${p.shared[l]} of English's ${p.enPassages} passages (${pct(p.shared[l])})`);
  return lines.join("\n");
}
