// A modify that refuses to hand back a rewritten app without one more try.
//
// "Fix this" has a verification gate. "Modify the app" only had a warning — and the warning fired,
// correctly, on the first real use: a change request came back as a brand new app with the person's
// entities and pages gone. The prompt already says "edit this source, do not replace it with a
// different app"; a fast model ignored it, and a warning after the fact is still a rewritten app in
// the editor. Instructions are not a gate.
//
// This is the smallest thing that IS one: judge the result's shape against the app as it stood, and
// if the change dropped entities or pages, send it straight back with that fact named — "your
// previous attempt removed the 'place' entity; apply only the requested change" — before a person
// ever sees it. One retry, because the failure is usually attention drift rather than intent, and a
// model told exactly what it dropped almost always keeps it the second time. If it drops something
// again the result is still returned, with the loss attached, so the caller can say so loudly — it
// is never silent, and it never burns a third call.

import { structuralLoss, type AppShape } from "@karta/runtime";

export interface GuardedModifyDeps {
  /** One model turn: the instruction in, the whole updated source out. */
  attempt: (instruction: string) => Promise<string>;
  /**
   * The shape of a candidate, for comparison. Throws when the candidate does not even load — that is
   * a different failure (the preview's own validation reports it), not a structural loss, so the
   * candidate is returned unjudged rather than retried on a guess.
   */
  shapeOf: (source: string) => Promise<AppShape>;
  /** The app as it stood when the person asked for the change. */
  before: AppShape;
  instruction: string;
}

export interface GuardedModifyResult {
  source: string;
  /** What the FINAL result still removes, or null. Non-null means the retry did not help either. */
  loss: string | null;
  /** Whether a second attempt was made — for a status line, and for the eval to count. */
  retried: boolean;
}

/** The retry instruction. Exported so the modify eval can assert it is what the model was told. */
export function retryInstruction(instruction: string, loss: string): string {
  return [
    instruction,
    "",
    `Your previous attempt ${loss}.`,
    "That is not the change that was asked for. Apply ONLY the change above. Every entity and every page the app",
    "already has must still be there, unchanged, in your reply.",
  ].join("\n");
}

export async function guardedModify(deps: GuardedModifyDeps): Promise<GuardedModifyResult> {
  const first = await deps.attempt(deps.instruction);
  const firstLoss = await judge(deps, first);
  if (firstLoss === null) return { source: first, loss: null, retried: false };

  const second = await deps.attempt(retryInstruction(deps.instruction, firstLoss));
  const secondLoss = await judge(deps, second);
  return { source: second, loss: secondLoss, retried: true };
}

async function judge(deps: GuardedModifyDeps, source: string): Promise<string | null> {
  let shape: AppShape;
  try {
    shape = await deps.shapeOf(source);
  } catch {
    // Cannot be judged, so cannot be called a loss. The preview will report why it did not load.
    return null;
  }
  return structuralLoss(deps.before, shape);
}
