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
import { applyEdits, describeEditFailures, EDIT_PLACEHOLDER_REPLACE, EDIT_PLACEHOLDER_SEARCH, parseEditsStrict, type EditFailure } from "./edits.js";
import { extractSource, looksLikeApp, parseModifyReply } from "./prompt.js";

export type ReadReply =
  | { kind: "edits"; source: string; applied: number; rationale?: string }
  | { kind: "whole-file"; source: string; rationale?: string }
  | { kind: "diagnosis"; text: string }
  | { kind: "no-match"; failures: EditFailure[] }
  | { kind: "unusable"; text: string };

// Mirrors edits.ts's own marker regexes (kept private there, so duplicated here rather than
// exported purely for this). Any drift between the two would show up as parseEditsStrict
// disagreeing with what this pass thought was a block, which the tests would catch.
const SEARCH_MARK = /^<{5,9} SEARCH\s*$/;
const DIVIDER_MARK = /^={5,9}\s*$/;
const REPLACE_MARK = /^>{5,9} REPLACE\s*$/;

const FENCE = /```[A-Za-z0-9_+.-]*[ \t]*\r?\n[\s\S]*?(?:```|$)/g;

/**
 * Remove each complete `<<<<<<< SEARCH … >>>>>>> REPLACE` block whose SEARCH body is the format's
 * own placeholder line, or whose REPLACE body is the format's own placeholder line — a model
 * echoing the template beside a real answer.
 *
 * Line-wise, not fence-wise: a placeholder block can share ONE fence with a real answer (a real
 * edit, or a whole file pasted right after it) and dropping the whole fence would take the real
 * answer down with it — exactly the failure this exists to prevent, not reproduce. A block that is
 * not cleanly closed with its own REPLACE marker (an unterminated block, or one reopened before it
 * closed) is left exactly as it is; `parseEditsStrict`, run afterward on the cleaned text, is what
 * reports a malformed block for real.
 */
function dropPlaceholderLines(reply: string): string {
  const lines = reply.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!SEARCH_MARK.test(line)) {
      out.push(line);
      i += 1;
      continue;
    }
    let divider = -1;
    let replace = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (SEARCH_MARK.test(lines[j]!)) break; // reopened before this one closed: not a clean block
      if (divider === -1 && DIVIDER_MARK.test(lines[j]!)) {
        divider = j;
        continue;
      }
      if (REPLACE_MARK.test(lines[j]!)) {
        replace = j;
        break;
      }
    }
    if (divider === -1 || replace === -1) {
      // Not a clean, closed block — pass just this line through and let the normal walk (and,
      // later, parseEditsStrict) deal with the rest of it.
      out.push(line);
      i += 1;
      continue;
    }
    const search = lines.slice(i + 1, divider).join("\n").trim();
    const replaceBody = lines.slice(divider + 1, replace).join("\n").trim();
    if (search !== EDIT_PLACEHOLDER_SEARCH && replaceBody !== EDIT_PLACEHOLDER_REPLACE) out.push(...lines.slice(i, replace + 1));
    i = replace + 1;
  }
  return out.join("\n");
}

/** A fence left with nothing but whitespace once its placeholder block was dropped is dropped too — an empty
 *  ```` ```ts\n``` ```` shell is not prose, and leaving it in would still read as rationale. */
function dropEmptyFences(text: string): string {
  return text.replace(FENCE, (block) => {
    const inner = block.replace(/^```[A-Za-z0-9_+.-]*[ \t]*\r?\n/, "").replace(/```\s*$/, "");
    return inner.trim() === "" ? "" : block;
  });
}

function dropPlaceholderBlocks(reply: string): string {
  return dropEmptyFences(dropPlaceholderLines(reply)).trim();
}

/**
 * Edits, a whole file, or nothing usable — WITHOUT the diagnosis rule. The fix loop uses this
 * directly because its contract is that a verdict marker counts only when it OPENS the reply
 * (loop.ts checks that first); a `NOT-IN-APP:` line mid-reply followed by a real edit is prose.
 *
 * Blocks whose SEARCH is the format's own placeholder are dropped first: a model that echoes the
 * template beside a real answer used to turn that answer into a no-match, twice, then "failed".
 */
export function readEditsOrFile(source: string, reply: string): Exclude<ReadReply, { kind: "diagnosis" }> {
  const cleaned = dropPlaceholderBlocks(reply);
  const strict = parseEditsStrict(cleaned);
  // Any malformed block means nothing is applied — including the blocks that WERE well-formed.
  // Applying those while dropping the broken one is the silent-partial-change defect this guards
  // against; the retry (noMatchInstruction) tells the model which block broke and asks again.
  if (strict.malformed.length) {
    const failures: EditFailure[] = strict.malformed.map((m) => ({ index: m.index, reason: "malformed", search: "", count: 0, detail: m.reason }));
    return { kind: "no-match", failures };
  }
  // Second line of defence: `dropPlaceholderBlocks` above already removes every clean placeholder
  // block by its own SEARCH/REPLACE markers, so this should normally find nothing left to filter —
  // but a placeholder edit that slipped through must still never be applied as if it were real.
  const edits = strict.edits.filter((e) => e.search.trim() !== EDIT_PLACEHOLDER_SEARCH);
  if (edits.length) {
    const applied = applyEdits(source, edits);
    if (!applied.ok) return { kind: "no-match", failures: applied.failures };
    // Prose before the first block is the rationale; an opening fence right before it is not.
    const firstBlock = /^<{5,9} SEARCH/m.exec(cleaned)?.index ?? 0;
    const rationale = cleaned.slice(0, firstBlock).replace(/```[A-Za-z]*\s*$/, "").trim();
    return rationale ? { kind: "edits", source: applied.source, applied: applied.applied, rationale } : { kind: "edits", source: applied.source, applied: applied.applied };
  }
  const whole = extractSource(cleaned);
  if (looksLikeApp(whole)) {
    const parsed = parseModifyReply(cleaned);
    const rationale = parsed.kind === "source" ? parsed.rationale : undefined;
    return rationale ? { kind: "whole-file", source: whole, rationale } : { kind: "whole-file", source: whole };
  }
  return { kind: "unusable", text: cleaned };
}

/** The modify reader: a `NOT-IN-APP:` verdict wins over anything else in the reply, then the rest. */
export function readModifyReply(source: string, reply: string): ReadReply {
  const parsed = parseModifyReply(reply);
  if (parsed.kind === "diagnosis") return { kind: "diagnosis", text: parsed.text };
  return readEditsOrFile(source, reply);
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
  readonly attempts: number;
  readonly noMatchRetry: boolean;
  readonly lossRetry: boolean;
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
    "That is not the change that was asked for. Apply ONLY the change above, as SEARCH/REPLACE edits that make",
    "that change and nothing else. Do not remove any entity or page the app already has.",
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
  let attempts = 0;
  let noMatchRetry = false;
  let lossRetry = false;
  // A snapshot, not a shared reference: each result captures the trace as it stood at that point,
  // so a result returned before the loss retry can never end up reporting the retry that came after.
  const snap = (): ModifyTrace => Object.freeze({ attempts, noMatchRetry, lossRetry });
  const ask = async (instruction: string): Promise<ReadReply> => {
    attempts += 1;
    return readModifyReply(deps.source, await deps.attempt(instruction));
  };

  let reply = await ask(deps.instruction);
  if (reply.kind === "no-match") {
    noMatchRetry = true;
    reply = await ask(noMatchInstruction(deps.instruction, reply.failures));
    // `describeEditFailures` is addressed to the model ("copy the lines exactly as they appear") and
    // belongs in `noMatchInstruction`, not in a sentence a person reads.
    if (reply.kind === "no-match") {
      return { kind: "failed", reason: "the model could not point at the lines it meant to change, even after being told which edit missed", trace: snap() };
    }
  }
  if (reply.kind === "diagnosis") return { kind: "diagnosis", text: reply.text, trace: snap() };
  if (reply.kind === "unusable") {
    return { kind: "failed", reason: "the model replied with an explanation instead of a change", trace: snap() };
  }

  const first = toResult(reply, await judge(deps, reply.source), snap());
  if (first.loss === null) return first;

  // The shape gate. One retry with the loss named; if the retry gives nothing usable, the lossy
  // result goes back WITH its loss so the caller can say so loudly — never silently, never nothing.
  lossRetry = true;
  const again = await ask(retryInstruction(deps.instruction, first.loss));
  if (again.kind === "diagnosis") return { kind: "diagnosis", text: again.text, trace: snap() };
  if (again.kind !== "edits" && again.kind !== "whole-file") return { ...first, trace: snap() };
  return toResult(again, await judge(deps, again.source), snap());
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
