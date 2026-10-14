// Did the model write in the language it was asked to (#301)? The eval's two checks, model-free so
// they are unit-tested (test/language-eval.test.ts) and the runners only wire them:
//
//   - LABELS: the app's words that are new in the result (all of them, for a created app) — read off
//     the source by `userFacingStrings` — each classified by `classifyText`;
//   - REPLY: what the model said to the person (a change's explanation, its Not done lines, a refusal
//     or a question), classified as one text.
//
// Both are heuristics with the limits written at `classifyText` (language.ts): a label too short to
// tell is UNKNOWN and left out of the rate, never counted as a pass or a fail. A case with nothing
// classifiable reports null, and the summary says how many those were.

import { classifyText, userFacingStrings, type Language } from "./language.js";

export interface LabelCheck {
  /** Which language the labels were expected in. */
  expected: Language;
  /** New user-facing strings in the result. */
  labels: number;
  /** Of those, classified as the expected language / as another language / unknown. */
  inExpected: number;
  inOther: number;
  unknown: number;
  /** Up to five that read as another language, for the report. */
  offenders: string[];
  /** Every classifiable new label is in the expected language; null when none could be classified. */
  passed: boolean | null;
}

/** The user-facing strings of `after` that `before` did not have (all of them when there is no before). */
export function newLabels(after: string, before?: string): string[] {
  const had = new Set(before ? userFacingStrings(before) : []);
  return [...new Set(userFacingStrings(after))].filter((s) => !had.has(s));
}

/** Classify each label; passed when every one that can be told is in `expected`. */
export function checkLabels(labels: readonly string[], expected: Language): LabelCheck {
  let inExpected = 0;
  let inOther = 0;
  let unknown = 0;
  const offenders: string[] = [];
  for (const l of labels) {
    const lang = classifyText(l);
    if (lang === null) unknown += 1;
    else if (lang === expected) inExpected += 1;
    else {
      inOther += 1;
      if (offenders.length < 5) offenders.push(`${l} (${lang})`);
    }
  }
  const told = inExpected + inOther;
  return { expected, labels: labels.length, inExpected, inOther, unknown, offenders, passed: told ? inOther === 0 : null };
}

/** The language of what the model said to the person, code spans left out: null when it says too little. */
export function replyLanguage(text: string): Language | null {
  const prose = text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/\b(ASK|NOT-IN-APP|QUESTION):/g, " ")
    .replace(/\bNot done:/g, " ");
  return classifyText(prose);
}

export interface LanguageSummary {
  /** Cases whose new labels could be classified, and how many of those passed. */
  labelsChecked: number;
  labelsPassed: number;
  /** Labels across every case, by verdict. */
  labels: { inExpected: number; inOther: number; unknown: number };
  /** Cases whose reply could be classified, and how many were in the person's language. */
  repliesChecked: number;
  repliesPassed: number;
}

export function summarizeLanguage(rows: ReadonlyArray<{ labels?: LabelCheck | null; reply?: { passed: boolean | null } | null }>): LanguageSummary {
  const s: LanguageSummary = { labelsChecked: 0, labelsPassed: 0, labels: { inExpected: 0, inOther: 0, unknown: 0 }, repliesChecked: 0, repliesPassed: 0 };
  for (const r of rows) {
    if (r.labels) {
      s.labels.inExpected += r.labels.inExpected;
      s.labels.inOther += r.labels.inOther;
      s.labels.unknown += r.labels.unknown;
      if (r.labels.passed !== null) {
        s.labelsChecked += 1;
        if (r.labels.passed) s.labelsPassed += 1;
      }
    }
    if (r.reply && r.reply.passed !== null) {
      s.repliesChecked += 1;
      if (r.reply.passed) s.repliesPassed += 1;
    }
  }
  return s;
}
