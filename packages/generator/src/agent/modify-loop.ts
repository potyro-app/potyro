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
// This replaces the single repair round: the loop itself keeps going until the app runs.
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
import { describeRun, type GatedRun, type RunGate } from "../run-report.js";
import { runTool, toolSpecs, type AgentTool } from "./tools.js";
import type { LoopStep } from "./loop.js";

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
  | { kind: "failed"; reason: string }
  | { kind: "stopped" };

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
  maxSteps?: number;
  onStep?: (step: LoopStep) => void;
  signal?: AbortSignal;
  resumeFrom?: ChatMessage[];
}

// Raised from 8 with #262: reading the corpus and fixing what a run reports both take steps, and a
// change that runs is worth the extra turns over one that is handed back broken.
const DEFAULT_MAX_STEPS = 12;
const ASK = "ASK:";
/** The tools whose use makes a refusal informed. */
const DISCOVERY = new Set(["lookup", "check", "example", "search_corpus", "read"]);

export async function runModifyLoop(deps: ModifyLoopDeps): Promise<ModifyLoopOutcome> {
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const messages: ChatMessage[] = deps.resumeFrom
    ? [...deps.resumeFrom]
    : [
        { role: "system", content: deps.system },
        { role: "user", content: `${buildModifyOpener()}\n\n\`\`\`ts\n${deps.source}\n\`\`\`\n\n${buildModifyMessage(deps.instruction)}` },
      ];
  let looked = false;
  let nudged = false;
  let failedCandidates = 0;
  let unusableReplies = 0;
  /** Candidates whose warnings were already pointed out: sent again unchanged, they are accepted. */
  const warned = new Set<string>();

  for (let step = 0; step < maxSteps; step += 1) {
    if (deps.signal?.aborted) return { kind: "stopped" };
    deps.onStep?.({ kind: "thinking" });
    const res = await deps.engine.chat.completions.create({
      ...(deps.model ? { model: deps.model } : {}),
      messages,
      tools: toolSpecs(deps.tools),
      tool_choice: "auto",
      temperature: 0.1,
    });
    const choice = res.choices[0]?.message;
    const calls = choice?.tool_calls ?? [];
    const text = choice?.content ?? "";

    if (calls.length) {
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
        deps.onStep?.({ kind: "tool", name: result.name, ok: result.ok, detail: result.detail });
        messages.push({ role: "tool", tool_call_id: c.id, content: result.detail });
        if (deps.signal?.aborted) return { kind: "stopped" };
      }
      continue;
    }

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
            "Before answering NOT-IN-APP, use the tools: call `lookup` on the type, option or ctx member you believe is missing " +
            "(and `check` a candidate if you have one). Then answer again — with edits if the declaration shows a way, " +
            "or with NOT-IN-APP quoting what `lookup` returned.",
        });
        continue;
      }
      return { kind: "diagnosis", text: verdict };
    }

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
      continue;
    }

    // The gate: it must compile and validate, and it must not have dropped entities or pages.
    const candidate = read.source;
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
    if (!problem && deps.run) {
      gated = await deps.run(candidate);
      const { report, preexisting } = gated;
      if (report.errors.length) problem = `It compiles and validates, but your change breaks it when it runs. ${describeRun(report, preexisting)}`;
      else if (report.warnings.length && !warned.has(candidate)) {
        warned.add(candidate);
        problem =
          `It compiles and validates, and nothing new threw — but look at this. ${describeRun(report, preexisting)}\n` +
          "If that is what the person asked for, send the same edits again unchanged and they will be accepted; otherwise fix it.";
      }
    }
    const passed = gated
      ? `compiles, validates, keeps the app's shape, and runs without breaking anything (${gated.report.ran || "nothing to run"})`
      : "compiles, validates, keeps the app's shape";
    deps.onStep?.({ kind: "candidate", passed: problem === null, detail: problem ?? passed });
    if (problem === null) {
      return {
        kind: "source",
        source: candidate,
        via: read.kind,
        applied: read.kind === "edits" ? read.applied : 0,
        ...(read.rationale ? { rationale: read.rationale } : {}),
        ...(read.notDone?.length ? { notDone: read.notDone } : {}),
      };
    }
    failedCandidates += 1;
    messages.push({ role: "assistant", content: text });
    messages.push({
      role: "user",
      content:
        `${problem}\n\nYour edits were applied to the app as first shown, not to your previous attempt — that change is not in the app. ` +
        "Send the complete set of edits you want against the app as first shown. If you are unsure whether an option exists, `lookup` it; " +
        "if you are unsure whether a candidate validates, `check` it before sending.",
    });
  }

  if (deps.signal?.aborted) return { kind: "stopped" };
  return {
    kind: "failed",
    reason: `gave up after ${maxSteps} step${maxSteps === 1 ? "" : "s"} (${failedCandidates} candidate${failedCandidates === 1 ? "" : "s"} failed the check, ${unusableReplies} repl${unusableReplies === 1 ? "y was" : "ies were"} not a change)`,
  };
}
