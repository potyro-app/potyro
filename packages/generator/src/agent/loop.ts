// The loop that lets the agent investigate instead of guessing — and, more importantly, the rule
// that stops it declaring victory.
//
// Today an edit that compiles, validates and renders is reported as a fix, while clicking the thing
// the user complained about still does nothing. So `kind: "fix"` is returned ONLY after the user's
// own recorded case has been replayed against the candidate and passed. A rejected candidate is fed
// back as a tool-shaped failure, because "your patch did not fix it" is the single most useful
// sentence the model never hears today.
//
// Every other exit is honest about itself: a question, a diagnosis that the fault is not the app's,
// exhaustion, or a user stop. None of them claim success.
//
// One more exit, checked before anything else runs: `kind: "no-repro"`. The user's own case is
// replayed once, up front, against the app AS IT IS — the `baseline` in `LoopDeps`. If that already
// passes, no candidate can prove more than the baseline already did, so the loop refuses to start
// and says so. This is not a failure of the agent and not a fix; a UI must render it as neither.

import { appFilesNote, isJoinedApp, joinedModules } from "../app-files.js";
import type { ChatEngine, ChatMessage } from "../chat-backend.js";
import { describeEditFailures } from "../edits.js";
import { readEditsOrFile } from "../guarded-modify.js";
import { appLanguage, changeLanguageInstruction, type Language } from "../language.js";
import { runTool, toolSpecs, type AgentTool } from "./tools.js";

export type LoopOutcome =
  | { kind: "fix"; source: string; rationale: string }
  | {
      // A real proposal that could NOT be proven, because the user's recorded case already passed
      // before any change — so replaying it after one proves nothing. Distinct from `fix` on
      // purpose: `fix` means "your own steps failed, and now they pass". This means "here is a
      // change based on what you described, and I could not check it". Applying it is a judgement
      // call the person makes with that stated, not a guarantee anyone is making.
      kind: "unverified-fix";
      source: string;
      rationale: string;
      /** Why it could not be proven, in terms of what replay can and cannot see. */
      why: string;
    }
  | {
      kind: "question";
      text: string;
      /**
       * Everything the agent had established before it asked — the opening system/task pair, every
       * tool call and result, every rejected candidate — so an answer can be handed back in via
       * `LoopDeps.resumeFrom` and reach an agent that remembers why it asked, instead of restarting
       * from nothing. Includes the assistant turn that asked the question itself.
       *
       * Rejected candidates embedded in assistant messages here FAILED replay — show them, never apply them.
       */
      transcript: ChatMessage[];
    }
  | { kind: "diagnosis"; text: string }
  | {
      // Nothing was investigated, and the reason is on OUR side of the line: no engine that can
      // drive a tool loop, no key for it, nothing recorded to work from. Distinct from `diagnosis`
      // because that one is a claim ABOUT THE APP ("this isn't in your app") — and a UI that
      // renders the two the same tells someone their app is fine when what actually happened is
      // that they forgot a key or a note. Nothing here was looked at, so nothing here is a verdict.
      kind: "refused";
      text: string;
    }
  | {
      kind: "exhausted";
      reason: string;
      /** The last candidate tried. It FAILED replay — show it, never apply it. */
      lastAttempt?: string;
    }
  | {
      kind: "stopped";
      /** The last candidate tried. It FAILED replay — show it, never apply it. */
      lastAttempt?: string;
    }
  | {
      // NOT a failure of the agent, and not a fix either: the user's own recorded case already
      // succeeds against the app AS IT IS, before any candidate is even proposed. The honest
      // statement is "I cannot reproduce what you reported" — a legitimate answer this system could
      // not previously give. A UI must render this as neither success nor failure; it's a third
      // thing.
      kind: "no-repro";
      /** What replaying the case against the app as-is actually showed (from `deps.baseline`). */
      detail: string;
    };

export type LoopStep =
  | { kind: "thinking" }
  | { kind: "tool"; name: string; ok: boolean; detail: string }
  /** `n`: which candidate this is, counted from 1 (the modify loop sets it; the eval reads it).
   *  `draft`: which independent first draft's chain it came from (the create loop, #262 phase 3). */
  | { kind: "candidate"; passed: boolean; detail: string; n?: number; draft?: number }
  /** `repeat`: the model repeated itself (a reply, or the same tool call). `restart`: the modify loop
   *  started a fresh chain from the app and the request (#278). */
  | { kind: "unusable"; detail: string; repeat?: boolean; restart?: boolean };

export interface LoopDeps {
  engine: ChatEngine;
  model?: string;
  tools: AgentTool[];
  system: string;
  /** What the user reported, in their words. */
  task: string;
  /** The app as the person has it. Shown to the model in the opening turn; edits are applied to it. */
  source: string;
  /** The person's language (#301): the explanation and any question come back in it. English when absent. */
  language?: Language;
  /** The language of the app's own words when the app declares one (#302); read off the source otherwise. */
  appLanguage?: Language | null;
  /** Compile + replay the candidate. The loop cannot succeed without this passing. */
  verify: (candidate: string) => Promise<{ passed: boolean; detail: string }>;
  /**
   * The user's own case, replayed against the app AS IT IS — before any candidate exists. Required,
   * because the loop cannot tell "no repro" from "found it" without knowing where it started: a
   * large share of real reports ("the page opens but shows nothing") replay-PASS today even though
   * the app is broken, since the page exists and the query runs — it just returns no rows. Left
   * unchecked, the first candidate that merely compiles replays to the same passing verdict the
   * baseline already had, and `kind: "fix"` comes back having proven nothing. See the check at the
   * top of `runAgentLoop` for what this gates.
   */
  baseline: { passed: boolean; detail: string };
  /**
   * Resume a loop that previously exited with `kind: "question"`: pass its `transcript` back with
   * the person's answer appended. When present, this SEEDS `messages` in place of the opening
   * system/task pair, so tool results and rejected candidates from before the question survive into
   * this run.
   *
   * This must never become a way to skip what makes this loop trustworthy: the no-repro guard above
   * still runs first regardless of `resumeFrom` (a resumed loop is not exempt from "does this even
   * reproduce"), and THE RULE is untouched — `kind: "fix"` still comes only from the one `return`
   * guarded by an awaited, passing `deps.verify(candidate)`. Resuming changes what the model sees;
   * it does not change what it takes to be believed.
   *
   * A transcript passed here must carry the app in its opening user turn (this loop always writes
   * it there); edits are applied to `source`, so a synthesized transcript that never showed the
   * model the app gives it a file it has not seen.
   */
  resumeFrom?: ChatMessage[];
  maxSteps?: number;
  /** Called as work happens, so a person can watch. */
  onStep?: (step: LoopStep) => void;
  /**
   * Aborts the loop between steps.
   *
   * Watching without being able to stop is worse than not watching: you see it go down the wrong
   * path and can only wait. Checked before each model turn and after each tool result, so a stop
   * takes effect at the next boundary rather than mid-call.
   */
  signal?: AbortSignal;
}

const DEFAULT_MAX_STEPS = 8;
const ASK = "ASK:";
const NOT_IN_APP = "NOT-IN-APP:";

/**
 * The opening turn: the person's words, then the language line when there is one (#301), then the
 * app. The app stays LAST: `sourceShownIn` (shell start-fix.ts) reads it back from the end of this turn.
 */
function openingTask(deps: LoopDeps): string {
  const language = changeLanguageInstruction({ person: deps.language, app: deps.appLanguage ?? appLanguage(deps.source) });
  // An app of several files (#448) says so; for an app that is one file this turn is unchanged.
  const files = isJoinedApp(deps.source) ? `\n\n${appFilesNote(joinedModules(deps.source))}` : "";
  return `${deps.task}${language ? `\n\n${language}` : ""}${files}\n\nThe app as it is:\n\`\`\`ts\n${deps.source}\n\`\`\``;
}

export async function runAgentLoop(deps: LoopDeps): Promise<LoopOutcome> {
  // WHY THIS COMES FIRST: verifying a candidate against a check that was already green proves
  // nothing. If the user's recorded case already passes against the app as it is — no candidate,
  // no edit, nothing changed — then replaying it again after a "fix" can only pass for the same
  // reason it passed just now, which is not evidence of anything. Rather than spend a model call
  // chasing a candidate whose success is guaranteed by the baseline it's compared against, the loop
  // says so plainly: it cannot reproduce what was reported. That's not the agent failing; it's the
  // agent being honest before it has spent anything at all.
  // A PASSING BASELINE IS NOT "NOTHING IS WRONG". This used to return `no-repro` and refuse to
  // start, on the reasoning that verifying against an already-green check proves nothing. The
  // reasoning is sound and the behaviour was wrong, because of what replay can actually SEE: it
  // checks that a page resolved and its query ran. It has no idea what rendered. A map stuck on
  // "Loading…" forever, a blank list, a wrong label — every one of those replays perfectly clean.
  // So the gate fired hardest on exactly the bugs a person is most likely to report and replay is
  // least able to detect, and told them their app was fine while they were looking at it broken.
  //
  // So: investigate anyway, using their own words as the problem statement. What we must NOT do is
  // then call the result a fix — with a green baseline, a passing verify is guaranteed and means
  // nothing. Those come back as `unverified-fix`, which says plainly that it could not be proven.
  const unprovable = deps.baseline.passed;

  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  // A resumed loop starts from what the earlier run had already established — not from a fresh
  // system/task pair, which would be exactly the amnesia this task exists to end. Copied, not
  // aliased: this function only ever appends to `messages`, never back into the caller's array.
  const messages: ChatMessage[] = deps.resumeFrom
    ? [...deps.resumeFrom]
    : [
        { role: "system", content: deps.system },
        { role: "user", content: openingTask(deps) },
      ];
  let lastAttempt: string | undefined;
  // Counted so `exhausted.reason` can say WHAT went wrong, not just that it did — a watcher on
  // `onStep` otherwise sees only "thinking" repeated and a person debugging the agent (not the
  // app) has nothing to go on.
  let failedCandidates = 0;
  let unusableReplies = 0;
  let unmatchedEdits = 0;

  const stopped = (): LoopOutcome => ({ kind: "stopped", ...(lastAttempt ? { lastAttempt } : {}) });

  for (let step = 0; step < maxSteps; step += 1) {
    if (deps.signal?.aborted) return stopped();
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
      // The assistant turn that REQUESTED the calls must land before their results, and each
      // result must carry the matching id — an unpaired transcript is rejected by the provider
      // on the next turn.
      messages.push({ role: "assistant", content: text, tool_calls: calls });
      for (const c of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(c.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        const result = await runTool(deps.tools, { id: c.id, name: c.function.name, args });
        deps.onStep?.({ kind: "tool", name: result.name, ok: result.ok, detail: result.detail });
        messages.push({ role: "tool", tool_call_id: c.id, content: result.detail });
        if (deps.signal?.aborted) return stopped();
      }
      continue;
    }

    // A marker only counts when it OPENS the reply — matching `^` mid-text let a stray line like
    // `NOT-IN-APP: ...` inside an explanation that precedes a genuine candidate throw the candidate
    // away and report an unverified "diagnosis". Requiring it at the head is unambiguous: the model
    // either leads with the marker, or it didn't send one.
    const head = text.trimStart();
    if (head.startsWith(ASK)) {
      // The assistant turn that asked must be in the transcript handed back — otherwise a resumed
      // loop's first request would show the model an answer with no question in sight.
      messages.push({ role: "assistant", content: text });
      return {
        kind: "question",
        text: head.slice(ASK.length).split(/^```/m)[0]!.trim(),
        transcript: [...messages],
      };
    }
    if (head.startsWith(NOT_IN_APP)) {
      return { kind: "diagnosis", text: head.slice(NOT_IN_APP.length).split(/^```/m)[0]!.trim() };
    }

    const read = readEditsOrFile(deps.source, text);
    if (read.kind === "unusable" || read.kind === "no-match") {
      if (read.kind === "no-match") unmatchedEdits += 1;
      else unusableReplies += 1;
      deps.onStep?.({ kind: "unusable", detail: read.kind === "no-match" ? describeEditFailures(read.failures) : text.trim() || "(empty reply)" });
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "user",
        content:
          read.kind === "no-match"
            ? `Your edits could not be applied:\n${describeEditFailures(read.failures)}\nSend the edits again, copying every SEARCH block from the app exactly as it appears.`
            : `That was not a change to the app. Reply with SEARCH/REPLACE edits in one \`\`\`ts block, or "${ASK} <question>", or "${NOT_IN_APP} <what is wrong outside the app>".`,
      });
      continue;
    }
    const candidate = read.source;

    lastAttempt = candidate;
    const verdict = await deps.verify(candidate);
    deps.onStep?.({ kind: "candidate", passed: verdict.passed, detail: verdict.detail });
    if (verdict.passed) {
      // An unfenced edits reply (no lead-in prose split cleanly by a ```) must not leak raw
      // SEARCH/REPLACE markers into the rationale a person reads — the reader already extracted
      // the real prose (if any) for an `edits` reply, so use that instead of re-deriving it here.
      const rationale = read.kind === "edits" ? (read.rationale ?? "") : text.split("```")[0]!.trim();
      // THE RULE, unchanged: `kind: "fix"` is reachable ONLY after `deps.verify` — the user's own
      // recorded case, replayed — passed AND the baseline had failed, so that pass means something.
      // When the baseline was already green, the same pass is guaranteed and proves nothing, so the
      // candidate goes back as `unverified-fix`: a real proposal, honestly labelled as unproven.
      // Calling it a fix would be the exact claim-without-evidence this whole loop exists to stop.
      if (unprovable) {
        return {
          kind: "unverified-fix",
          source: candidate,
          rationale,
          why: `Replaying your recorded steps showed no failure, so there was nothing for a fix to prove itself against — replay follows navigation and data, not what actually rendered. This change is a proposal based on what you described: ${deps.baseline.detail}`,
        };
      }
      return { kind: "fix", source: candidate, rationale };
    }
    failedCandidates += 1;
    // The one sentence the model never hears today.
    messages.push({ role: "assistant", content: text });
    messages.push({
      role: "user",
      content: `Your change did NOT fix it. Replaying what the user did still gives:\n${verdict.detail}\nYour edits were applied to the app exactly as shown in the first message, not to your previous attempt — that change is not in the app. Send the complete set of edits you want against the app as first shown. Do not send the same edit again; investigate with the tools, then either fix it, ask, or say it is not the app's fault.`,
    });
  }

  // A stop that lands on the loop's LAST step (model reply arrives after abort, or fails verify
  // right as the budget runs out) must still read as "stopped", not "exhausted" — a late stop is
  // exactly when a user is most likely to hit the button.
  if (deps.signal?.aborted) return stopped();
  return {
    kind: "exhausted",
    reason: `gave up after ${maxSteps} steps (${failedCandidates} candidate${failedCandidates === 1 ? "" : "s"} failed replay, ${unusableReplies} repl${unusableReplies === 1 ? "y was" : "ies were"} not an app, ${unmatchedEdits} repl${unmatchedEdits === 1 ? "y" : "ies"} had edits that did not match)`,
    ...(lastAttempt ? { lastAttempt } : {}),
  };
}
