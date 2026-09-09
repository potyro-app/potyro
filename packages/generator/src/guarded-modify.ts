// A modify that reads the model's reply, applies its edits, and refuses to hand back a rewritten app
// without one more try.
//
// "Fix this" has a verification gate. "Modify the app" only had a warning — and the warning fired,
// correctly, on the first real use: a change request came back as a brand new app with the person's
// entities and pages gone. Instructions are not a gate. The first gate built here judged the reply's
// SHAPE (entities and pages) and retried once with the loss named. It worked: on 32 measured samples
// the one rewrite was caught. But the same measurement showed the deeper defect — two replies that
// kept every page and were still broken, because retyping two hundred lines to change three had
// doubled colons and renamed a key in lines the change never touched.
//
// So the reply is now EDITS (edits.ts): the model sends only the lines it changes, and this module
// applies them. Lines it does not mention cannot be damaged. Two retries remain, one per failure
// kind, each with the failure named: an edit whose SEARCH is not in the file ("edit 2 was not
// found; copy it exactly"), and a result that drops an entity or page ("your previous attempt
// removes the 'place' entity; apply only the change"). A whole-file reply is still accepted — a good
// one is not worth throwing away — but labelled, so the Studio can say so and the eval can count it.
// It is never silent, and it never burns a fourth call.

import { structuralLoss, type AppShape } from "@karta/runtime";
import { applyEdits, describeEditFailures, parseEdits, type EditFailure } from "./edits.js";
import { extractSource, looksLikeApp, parseModifyReply } from "./prompt.js";

export type ReadReply =
  | { kind: "edits"; source: string; applied: number; rationale?: string }
  | { kind: "whole-file"; source: string; rationale?: string }
  | { kind: "diagnosis"; text: string }
  | { kind: "no-match"; failures: EditFailure[] }
  | { kind: "unusable"; text: string };

/**
 * What a reply IS, applied to `source` where it is edits.
 *
 * A diagnosis wins over anything else in the reply, as it always has: acting on code the model has
 * just disowned is the failure the marker exists to prevent. Edits come before a whole file, so a
 * reply that edits the `defineApp({` line is not mistaken for a file.
 */
export function readModifyReply(source: string, reply: string): ReadReply {
  const parsed = parseModifyReply(reply);
  if (parsed.kind === "diagnosis") return { kind: "diagnosis", text: parsed.text };

  const edits = parseEdits(reply);
  if (edits.length) {
    const applied = applyEdits(source, edits);
    if (!applied.ok) return { kind: "no-match", failures: applied.failures };
    // Prose before the first block is the rationale; an opening fence right before it is not.
    const firstBlock = /^<{5,9} SEARCH/m.exec(reply)?.index ?? 0;
    const rationale = reply.slice(0, firstBlock).replace(/```[A-Za-z]*\s*$/, "").trim();
    return rationale ? { kind: "edits", source: applied.source, applied: applied.applied, rationale } : { kind: "edits", source: applied.source, applied: applied.applied };
  }

  const whole = extractSource(reply);
  if (looksLikeApp(whole)) {
    return parsed.rationale ? { kind: "whole-file", source: whole, rationale: parsed.rationale } : { kind: "whole-file", source: whole };
  }
  return { kind: "unusable", text: reply.trim() };
}

export interface GuardedModifyDeps {
  /** One model turn: the instruction in, the model's REPLY out — edits, a file, or a verdict. */
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
  /** The app's source as it stands — what the edits apply to. */
  source: string;
}

export interface ModifyTrace {
  attempts: number;
  noMatchRetry: boolean;
  lossRetry: boolean;
}

export type GuardedModifyResult =
  | {
      kind: "source";
      source: string;
      /** Whether the model sent edits (the contract) or the whole file (accepted, but a fallback). */
      via: "edits" | "whole-file";
      /** Edit blocks applied; 0 for a whole-file reply. */
      applied: number;
      /** What the FINAL result still removes, or null. Non-null means the retry did not help either. */
      loss: string | null;
      rationale?: string;
      trace: ModifyTrace;
    }
  | { kind: "diagnosis"; text: string; trace: ModifyTrace }
  | { kind: "failed"; reason: string; trace: ModifyTrace };

/** The loss retry. Exported so the modify eval can assert it is what the model was told. */
export function retryInstruction(instruction: string, loss: string): string {
  return [
    instruction,
    "",
    `Your previous attempt ${loss}.`,
    "That is not the change that was asked for. Apply ONLY the change above. Every entity and every page the app",
    "already has must still be there, unchanged, in your reply.",
  ].join("\n");
}

/** The no-match retry: which edit failed and why, then the same request again. */
export function noMatchInstruction(instruction: string, failures: EditFailure[]): string {
  return [
    instruction,
    "",
    "Your previous reply could not be applied:",
    describeEditFailures(failures),
    "Send the edits again, copying every SEARCH block from the app above exactly as it appears there.",
  ].join("\n");
}

export async function guardedModify(deps: GuardedModifyDeps): Promise<GuardedModifyResult> {
  const trace: ModifyTrace = { attempts: 0, noMatchRetry: false, lossRetry: false };
  const ask = async (instruction: string): Promise<ReadReply> => {
    trace.attempts += 1;
    return readModifyReply(deps.source, await deps.attempt(instruction));
  };

  let reply = await ask(deps.instruction);
  if (reply.kind === "no-match") {
    trace.noMatchRetry = true;
    reply = await ask(noMatchInstruction(deps.instruction, reply.failures));
    if (reply.kind === "no-match") return { kind: "failed", reason: describeEditFailures(reply.failures), trace };
  }
  if (reply.kind === "diagnosis") return { kind: "diagnosis", text: reply.text, trace };
  if (reply.kind === "unusable") {
    return { kind: "failed", reason: "the model replied with an explanation instead of a change", trace };
  }

  const first = toResult(reply, await judge(deps, reply.source), trace);
  if (first.loss === null) return first;

  // The shape gate. One retry with the loss named; if the retry gives nothing usable, the lossy
  // result goes back WITH its loss so the caller can say so loudly — never silently, never nothing.
  trace.lossRetry = true;
  const again = await ask(retryInstruction(deps.instruction, first.loss));
  if (again.kind === "diagnosis") return { kind: "diagnosis", text: again.text, trace };
  if (again.kind !== "edits" && again.kind !== "whole-file") return { ...first, trace };
  return toResult(again, await judge(deps, again.source), trace);
}

function toResult(
  reply: Extract<ReadReply, { kind: "edits" | "whole-file" }>,
  loss: string | null,
  trace: ModifyTrace,
): Extract<GuardedModifyResult, { kind: "source" }> {
  const base = { kind: "source" as const, source: reply.source, via: reply.kind, applied: reply.kind === "edits" ? reply.applied : 0, loss, trace };
  return reply.rationale ? { ...base, rationale: reply.rationale } : base;
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
