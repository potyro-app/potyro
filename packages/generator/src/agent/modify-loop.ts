// The modify loop (#131): "change this app" on the same footing as "fix this app".
//
// The Studio's modify used to be one raw model turn — source in, edits or a refusal out — with a
// single repair round after the fact. The fix loop (loop.ts) had tools, a verify gate and a rule
// that a candidate counts only when the gate passes. This is that loop for a change request: the
// model can `lookup` the declaration it is unsure of and `check` a candidate before sending it,
// every candidate must compile, validate and keep the app's shape, and a refusal is only accepted
// after the model has actually looked — a NOT-IN-APP with no tool call behind it is sent back once.
//
// #262: when the caller can run a candidate (`run`), passing the validator is no longer enough. The
// candidate is run on sample records and compared with the app as first shown; anything it newly
// breaks sends it back with the error in words, and a page that newly shows nothing is pointed out
// once — resending the same candidate means "that is meant". What was already failing is said as
// context and never holds a change back.
//
// The paid eval of that first version taught three more things, all here:
//   - the app is in the conversation EXACTLY ONCE. The first message carries it, and with it the
//     passages from the release's corpus that speak to the request (`primeCorpus`), so the model
//     starts from how a real app does it instead of searching for it; `check` takes edits, never a
//     second copy of the app;
//   - a model that repeats itself has stopped reasoning. A reply that repeats the previous one, or
//     is mostly one line said over and over, the same tool call three times in a row, or a candidate
//     already turned back, is a repeat. The first is ROLLED BACK (#278, docs/19 F1): the repeated
//     turns come out of the conversation and one note says what was tried, why it was turned back,
//     and the ways out (another approach, ASK:, NOT-IN-APP:). The second ends the loop with the best
//     candidate so far (one that passed every gate but a warning), if there is one;
//   - candidates and tool reads are counted apart. Reading the corpus is cheap and useful; a fourth
//     candidate that fails the gate is neither, so candidates have a budget of their own;
//   - a chain with two candidates turned back is not extended (docs/19 F2): it starts again from the
//     app and the request, with one line per attempt that was turned back. The steps and candidates
//     already spent stay spent — the budgets cover the whole loop, not each chain.
//
// Shares the fix loop's vocabulary (tool calls, ASK, the marker-at-the-head rule, the "edit the app
// as first shown" retry) and the modify contract's ladder (`buildModifyMessage`), so a model that has
// learned one has learned the other.

import type { AppShape } from "@potyro/runtime";
import { structuralLoss } from "@potyro/runtime";
import type { ChatEngine, ChatMessage } from "../chat-backend.js";
import { readEditsOrFile, retryInstruction } from "../guarded-modify.js";
import { describeEditFailures } from "../edits.js";
import { NOT_IN_APP, buildModifyMessage, buildModifyOpener } from "../prompt.js";
import { primeCorpus, type Corpus } from "../corpus.js";
import { describeRun, type GatedRun, type RunGate } from "../run-report.js";
import { runTool, toolSpecs, type AgentTool } from "./tools.js";
import type { LoopStep } from "./loop.js";
import { describeToolTurn, freshStartNote, oneLine, rollbackNote, toolTurnSignature, type TurnedBack } from "./loop-recovery.js";

export type ModifyLoopOutcome =
  | {
      kind: "source";
      source: string;
      via: "edits" | "whole-file";
      applied: number;
      rationale?: string;
      /** The parts of the request the model said it did not do (the ladder's third rung). */
      notDone?: string[];
    }
  | { kind: "diagnosis"; text: string }
  | { kind: "question"; text: string; transcript: ChatMessage[] }
  /**
   * It gave up. `reason` is for a developer (the step log, a transcript); `cause` is which way it
   * gave up, so the person can be told in their own words (studio-engine.ts).
   */
  | { kind: "failed"; reason: string; cause: GiveUp }
  | { kind: "stopped" };

/**
 * How it gave up: the model repeated itself, every candidate failed the check, or the steps ran out
 * — or, before the loop began, the chosen engine cannot drive it (`engine`, start-modify.ts).
 */
export type GiveUp = "repeated" | "candidates" | "steps" | "engine";

export interface ModifyLoopDeps {
  engine: ChatEngine;
  model?: string;
  tools: AgentTool[];
  system: string;
  /** The change the person asked for, in their words. */
  instruction: string;
  /** The app as they have it. Edits are applied to it; every retry is told so. */
  source: string;
  /** Bundle + validate a candidate: the validator's issues, or [] when well-formed. Throws when it does not compile. */
  check: (source: string) => Promise<string[]>;
  /** The candidate's shape, for the loss gate (entities and pages must survive a change). */
  shapeOf: (source: string) => Promise<AppShape>;
  before: AppShape;
  /** Run a candidate that passed the check on sample records, against the app as first shown
   *  (`regressionGate`, #262): only what the candidate breaks holds it back. Without it the gate stops
   *  at compile + validate + shape, as before. */
  run?: RunGate;
  /** The release's corpus: the passages that speak to the request go into the first message (#262). */
  corpus?: () => Promise<Corpus>;
  /** Model calls in all. */
  maxSteps?: number;
  /** Candidates that may fail the gate before the loop gives up. Tool reads do not count. */
  maxCandidates?: number;
  onStep?: (step: LoopStep) => void;
  signal?: AbortSignal;
  resumeFrom?: ChatMessage[];
  /**
   * Think hard (`reasoning: "high"`) for the one turn after the loop got stuck — a rolled-back
   * repeat or a fresh start (#280, docs/19 F6). The extra cost lands only on changes that were going
   * badly. Off unless the caller turns it on; the Studio's setting defaults it on.
   */
  escalate?: boolean;
}

// Raised from 8 with #262: reading the corpus and fixing what a run reports both take steps, and a
// change that runs is worth the extra turns over one that is handed back broken.
const DEFAULT_MAX_STEPS = 12;
const DEFAULT_MAX_CANDIDATES = 4;
/** A line said this often is the reply going in circles. */
const REPEAT_LINES = 5;
const ASK = "ASK:";
/** The tools whose use makes a refusal informed. */
const DISCOVERY = new Set(["lookup", "check", "example", "search_corpus", "read"]);

type Accepted = Extract<ModifyLoopOutcome, { kind: "source" }>;

/** Why a reply is the model repeating itself, or null when it is not. */
export function repeatsItself(text: string, previous: string | null): string | null {
  const now = text.trim();
  if (!now) return null;
  if (previous !== null && now === previous.trim()) return "the reply repeats the previous one word for word";
  const lines = now
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1);
  let most: [string, number] = ["", 0];
  for (const entry of counts) if (entry[1] > most[1]) most = entry;
  if (most[1] >= REPEAT_LINES && most[1] * 2 >= lines.length) return `the reply says "${most[0].slice(0, 60)}" ${most[1]} times`;
  return null;
}

async function firstMessage(deps: ModifyLoopDeps): Promise<string> {
  const parts = [buildModifyOpener(), `\`\`\`ts\n${deps.source}\n\`\`\``, buildModifyMessage(deps.instruction)];
  if (deps.corpus) {
    const primed = primeCorpus(await deps.corpus(), deps.instruction, deps.source);
    if (primed) parts.push(primed);
  }
  return parts.join("\n\n");
}

/** The same tool call with the same arguments this many times in a row is the model going round. */
const TOOL_REPEAT = 3;
/** Candidates turned back in one chain before it is started again from the app and the request. */
const RESTART_AFTER = 2;

export async function runModifyLoop(deps: ModifyLoopDeps): Promise<ModifyLoopOutcome> {
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxCandidates = deps.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  // The first message of a chain: the app, the request, the corpus passages. A fresh chain (F2)
  // starts from it again, with what was turned back added at the end.
  const opening = deps.resumeFrom ? (deps.resumeFrom.find((m) => m.role === "user")?.content ?? null) : await firstMessage(deps);
  let messages: ChatMessage[] = deps.resumeFrom
    ? [...deps.resumeFrom]
    : [
        { role: "system", content: deps.system },
        { role: "user", content: opening ?? "" },
      ];
  let looked = false;
  let nudged = false;
  let candidates = 0;
  let failedCandidates = 0;
  let unusableReplies = 0;
  let repeats = 0;
  /** Candidates turned back in this chain; at RESTART_AFTER the chain starts again. */
  let refusedInChain = 0;
  let previousReply: string | null = null;
  /** Where the previous reply sits in `messages`, so a word-for-word repeat is rolled back with its answer. */
  let previousReplyAt = -1;
  /** What answered the previous reply, in a line: the reason a repeat of it will not work either. */
  let previousAnswer = "";
  /** Consecutive turns that made the same tool calls with the same arguments. */
  // Typed by assertion: it is also reset inside `repeat`, which flow analysis does not follow.
  let toolStreak = null as { sig: string; count: number; at: number; tried: string; answer: string } | null;
  /** The last candidate that passed every gate but a warning: what the model meant, if it then stops making sense. */
  let held: Accepted | null = null;
  let heldOn = 0;
  /** Candidates whose warnings were already pointed out: sent again unchanged, they are accepted. */
  const warned = new Set<string>();
  /** The replies that carried them: sent again, that is a confirmation, not a repeat. */
  const warnedReplies = new Set<string>();
  /** Every candidate the gate turned back, with why: sent again — in this chain or a later one — it is a repeat. */
  const refused = new Map<string, TurnedBack>();
  const turnedBack: TurnedBack[] = [];
  /** The next model call thinks hard: the loop just rolled a repeat back or started afresh. */
  let stuck = false;

  const gaveUp = (cause: GiveUp, why: string): ModifyLoopOutcome => {
    if (held) {
      deps.onStep?.({ kind: "candidate", passed: true, n: heldOn, detail: `${why} — keeping the candidate that passed every check but a warning` });
      return held;
    }
    return { kind: "failed", reason: why, cause };
  };
  const budgetLine = (): string =>
    `${failedCandidates} candidate${failedCandidates === 1 ? "" : "s"} failed the check, ${unusableReplies} repl${unusableReplies === 1 ? "y was" : "ies were"} not a change`;

  /**
   * The model repeated itself (#278, F1). The first time, the repeated turns come out of the
   * conversation (`rollbackTo`: from there on) and one note goes in their place; the second time,
   * the loop gives up.
   */
  const repeat = (why: string, back: TurnedBack, rollbackTo: number): ModifyLoopOutcome | null => {
    repeats += 1;
    if (repeats >= 2) {
      deps.onStep?.({ kind: "unusable", detail: why, repeat: true });
      return gaveUp("repeated", `the model repeated itself twice (${why}; ${budgetLine()})`);
    }
    deps.onStep?.({ kind: "unusable", detail: `${why} — taken out, and asked for something different`, repeat: true });
    if (rollbackTo >= 0) messages.splice(rollbackTo);
    messages.push({ role: "user", content: rollbackNote(back) });
    stuck = true;
    previousReplyAt = -1;
    toolStreak = null;
    return null;
  };

  for (let step = 0; step < maxSteps; step += 1) {
    if (deps.signal?.aborted) return { kind: "stopped" };
    deps.onStep?.({ kind: "thinking" });
    const escalated = Boolean(deps.escalate && stuck);
    stuck = false;
    const res = await deps.engine.chat.completions.create({
      ...(deps.model ? { model: deps.model } : {}),
      messages,
      tools: toolSpecs(deps.tools),
      tool_choice: "auto",
      temperature: 0.1,
      ...(escalated ? { reasoning: "high" as const } : {}),
    });
    const choice = res.choices[0]?.message;
    const calls = choice?.tool_calls ?? [];
    const text = choice?.content ?? "";

    if (calls.length) {
      const sig = toolTurnSignature(calls);
      if (toolStreak?.sig === sig) toolStreak.count += 1;
      else toolStreak = { sig, count: 1, at: messages.length, tried: describeToolTurn(calls), answer: "" };
      if (toolStreak.count >= TOOL_REPEAT) {
        const s = toolStreak;
        const end = repeat(
          `the same tool call ${TOOL_REPEAT} times in a row (${s.tried})`,
          { tried: `${s.tried}, ${TOOL_REPEAT} times in a row`, reason: `the same answer each time: ${s.answer || "(nothing)"}` },
          s.at,
        );
        if (end) return end;
        continue;
      }
      const streak = toolStreak;
      messages.push({ role: "assistant", content: text, tool_calls: calls });
      for (const c of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(c.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        const result = await runTool(deps.tools, { id: c.id, name: c.function.name, args });
        if (DISCOVERY.has(result.name)) looked = true;
        if (streak.count === 1) streak.answer = oneLine(`${streak.answer} ${result.detail}`, 200);
        deps.onStep?.({ kind: "tool", name: result.name, ok: result.ok, detail: result.detail });
        messages.push({ role: "tool", tool_call_id: c.id, content: result.detail });
        if (deps.signal?.aborted) return { kind: "stopped" };
      }
      continue;
    }
    toolStreak = null;

    // The markers first: a question ends the turn, and a refusal said again after it was sent to the
    // tools is the model's answer — neither is a repeat to roll back.
    const head = text.trimStart();
    if (head.startsWith(ASK)) {
      messages.push({ role: "assistant", content: text });
      return { kind: "question", text: head.slice(ASK.length).split(/^```/m)[0]!.trim(), transcript: [...messages] };
    }
    if (head.startsWith(NOT_IN_APP)) {
      const verdict = head.slice(NOT_IN_APP.length).split(/^```/m)[0]!.trim();
      // An uninformed refusal is the failure this loop exists to end: the model assumed an option
      // was missing. Once, it is sent to the tools; a second refusal is accepted as its answer.
      if (!looked && !nudged) {
        nudged = true;
        deps.onStep?.({ kind: "unusable", detail: `refused without looking: ${verdict}` });
        messages.push({ role: "assistant", content: text });
        messages.push({
          role: "user",
          content:
            "Before answering NOT-IN-APP, use the tools: call `lookup` on the type, option or ctx member you believe is missing, " +
            "`search_corpus` for how a real app does it (and `check` a candidate if you have one). Then answer again — with edits " +
            "if they show a way, or with NOT-IN-APP quoting what they returned.",
        });
        continue;
      }
      return { kind: "diagnosis", text: verdict };
    }

    // Resending a candidate whose warning was pointed out is how the model says "that is meant".
    const repeated = warnedReplies.has(text.trim()) ? null : repeatsItself(text, previousReply);
    if (repeated) {
      const same = previousReply !== null && text.trim() === previousReply.trim();
      const end = repeat(
        repeated,
        { tried: oneLine(text) || "the same edits", reason: same ? previousAnswer || "nothing usable" : "the reply said the same line over and over, with nothing else" },
        same ? previousReplyAt : -1,
      );
      previousReply = text;
      if (end) return end;
      continue;
    }
    previousReply = text;
    previousReplyAt = messages.length;

    const read = readEditsOrFile(deps.source, text);
    if (read.kind === "unusable" || read.kind === "no-match") {
      unusableReplies += 1;
      deps.onStep?.({ kind: "unusable", detail: read.kind === "no-match" ? describeEditFailures(read.failures) : text.trim() || "(empty reply)" });
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "user",
        content:
          read.kind === "no-match"
            ? `Your edits could not be applied:\n${describeEditFailures(read.failures)}\nSend the edits again, copying every SEARCH block from the app as first shown exactly as it appears.`
            : `That was not a change to the app. Reply with SEARCH/REPLACE edits in one \`\`\`ts block, or "${ASK} <question>", or "${NOT_IN_APP} <what is wrong outside the app>".`,
      });
      previousAnswer = read.kind === "no-match" ? oneLine(`the edits could not be applied: ${describeEditFailures(read.failures)}`, 240) : "it was not a change to the app";
      continue;
    }

    const candidate = read.source;
    const tried = oneLine(read.rationale ?? "") || (read.kind === "edits" ? `a change of ${read.applied} edit${read.applied === 1 ? "" : "s"}` : "the whole file, rewritten");
    // The same change as one already turned back — in this chain or before a fresh start — is a
    // repeat, whatever words came with it.
    const seenBefore = warned.has(candidate) ? undefined : refused.get(candidate);
    if (seenBefore) {
      const end = repeat("the candidate is one that was already turned back", seenBefore, -1);
      if (end) return end;
      continue;
    }

    // The gate: it must compile and validate, and it must not have dropped entities or pages.
    candidates += 1;
    const accepted: Accepted = {
      kind: "source",
      source: candidate,
      via: read.kind,
      applied: read.kind === "edits" ? read.applied : 0,
      ...(read.rationale ? { rationale: read.rationale } : {}),
      ...(read.notDone?.length ? { notDone: read.notDone } : {}),
    };
    const { problem, warning, gated } = await gate(deps, candidate, warned);
    if (warning) {
      held = accepted;
      heldOn = candidates;
      warnedReplies.add(text.trim());
    }
    const passed = gated
      ? `compiles, validates, keeps the app's shape, and runs without breaking anything (${gated.report.ran || "nothing to run"})`
      : "compiles, validates, keeps the app's shape";
    deps.onStep?.({ kind: "candidate", passed: problem === null, n: candidates, detail: problem ?? passed });
    if (problem === null) return accepted;
    failedCandidates += 1;
    if (!warning) {
      const back = { tried, reason: oneLine(problem, 240) };
      refused.set(candidate, back);
      turnedBack.push(back);
      refusedInChain += 1;
    }
    if (candidates >= maxCandidates) return gaveUp("candidates", `${candidates} candidate${candidates === 1 ? "" : "s"} failed the check — the candidate budget is spent`);
    if (refusedInChain >= RESTART_AFTER && opening !== null) {
      // F2: a chain with two candidates turned back is not extended. It starts again from the app
      // and the request, with one line per attempt; the steps and candidates already spent stay spent.
      messages = [
        { role: "system", content: deps.system },
        { role: "user", content: `${opening}\n\n${freshStartNote(turnedBack)}` },
      ];
      refusedInChain = 0;
      stuck = true;
      previousReply = null;
      previousReplyAt = -1;
      previousAnswer = "";
      deps.onStep?.({ kind: "unusable", detail: "starting again from the app and the request, with a note of what was turned back", restart: true });
      continue;
    }
    messages.push({ role: "assistant", content: text });
    messages.push({
      role: "user",
      content:
        `${problem}\n\nYour edits were applied to the app as first shown, not to your previous attempt — that change is not in the app. ` +
        "Send the complete set of edits you want against the app as first shown. If you are unsure whether an option exists, `lookup` it; " +
        "if you are unsure whether a candidate validates, `check` your edits before sending.",
    });
    previousAnswer = oneLine(problem, 240);
  }

  if (deps.signal?.aborted) return { kind: "stopped" };
  return gaveUp("steps", `gave up after ${maxSteps} step${maxSteps === 1 ? "" : "s"} (${budgetLine()})`);
}

/**
 * Compile + validate, the shape, and — when the caller can run it — a regression run (#262). A
 * warning is a problem once per candidate: pointed out, and the same candidate sent again passes.
 */
async function gate(deps: ModifyLoopDeps, candidate: string, warned: Set<string>): Promise<{ problem: string | null; warning: boolean; gated: GatedRun | null }> {
  let problem: string | null = null;
  try {
    const issues = await deps.check(candidate);
    if (issues.length) problem = `The result failed validation:\n${issues.map((i) => `- ${i}`).join("\n")}`;
  } catch (e) {
    problem = `The result does not compile: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (!problem) {
    let shape: AppShape | null = null;
    try {
      shape = await deps.shapeOf(candidate);
    } catch {
      shape = null; // cannot be judged for loss; validation already passed
    }
    const loss = shape ? structuralLoss(deps.before, shape) : null;
    if (loss) problem = retryInstruction("", loss).trim();
  }
  let gated: GatedRun | null = null;
  let warning = false;
  if (!problem && deps.run) {
    gated = await deps.run(candidate);
    const { report, preexisting } = gated;
    if (report.errors.length) problem = `It compiles and validates, but your change breaks it when it runs. ${describeRun(report, preexisting)}`;
    else if (report.warnings.length && !warned.has(candidate)) {
      warned.add(candidate);
      warning = true;
      problem =
        `It compiles and validates, and nothing new threw — but look at this. ${describeRun(report, preexisting)}\n` +
        "If that is what the person asked for, send the same edits again unchanged and they will be accepted; otherwise fix it.";
    }
  }
  return { problem, warning, gated };
}
