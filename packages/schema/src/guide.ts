// An app's guide (#80): how to use it, in a few steps, written with the app and carried by it.
//
// A person who describes an app gets it and has to experiment to learn how it works; someone who is
// sent it has even less, they never saw the conversation. So the app says it itself: `guide`, a short
// ordered list of steps, words like every other word of the app (translated through its catalogs).
// The shell shows them on first open and from the app's menu. They are data, never code: a shared
// app's guide is text the shell draws, clamped here whatever the app declared.

import { z } from "zod";
import type { Words } from "./types/words.js";
import { isContextWords, isWordsMap, zWords } from "./words-schema.js";

/** How long a guide may be: steps, characters in a step as written, and as shown (a translation runs longer). */
export const GUIDE_LIMITS = { steps: 6, chars: 160, shownChars: 320 } as const;

/** Every text a step holds: its string, a `{ text, context }`'s text, each language of a map. */
function textsOf(step: Words): string[] {
  if (typeof step === "string") return [step];
  if (isContextWords(step)) return [step.text];
  return isWordsMap(step) ? Object.values(step).filter((v): v is string => typeof v === "string") : [];
}

/** One step: words (so the walker in words.ts finds it), one line, short. */
const guideStepSchema = zWords.superRefine((step, ctx) => {
  for (const text of textsOf(step)) {
    if (!text.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a step says one thing to do; an empty one says nothing — write it or take it out" });
    else if (/[\r\n]/.test(text)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a step is one line of plain text; make a second step of what follows the line break" });
    else if (text.length > GUIDE_LIMITS.chars) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `this step is ${text.length} characters; a step is one sentence of at most ${GUIDE_LIMITS.chars} — shorten it, or split it in two` });
    }
  }
});

/** `AppDefinition.guide`: 1–6 steps. */
export const guideSchema = z
  .array(guideStepSchema)
  .min(1, "a guide has at least one step; with nothing to say, leave `guide` out")
  .max(GUIDE_LIMITS.steps, `a guide has at most ${GUIDE_LIMITS.steps} steps — keep the ones a first visit needs`);

/**
 * A guide's steps as the shell shows them: strings only (the definition already in the person's
 * language), whitespace collapsed, at most `GUIDE_LIMITS.steps` of them and each cut at
 * `GUIDE_LIMITS.shownChars`. Whatever else was declared — an app read out of the sealed box is not to
 * be believed — is left out, so the result is always safe to draw as text.
 */
export function guideSteps(guide: unknown): string[] {
  if (!Array.isArray(guide)) return [];
  const steps: string[] = [];
  for (const step of guide) {
    if (typeof step !== "string") continue;
    const text = step.replace(/\s+/g, " ").trim();
    if (!text) continue;
    steps.push(text.length > GUIDE_LIMITS.shownChars ? `${text.slice(0, GUIDE_LIMITS.shownChars - 1).trimEnd()}…` : text);
    if (steps.length === GUIDE_LIMITS.steps) break;
  }
  return steps;
}
