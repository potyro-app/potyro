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

import { extractSource, looksLikeApp } from "../prompt.js";
import type { ChatEngine, ChatMessage } from "../chat-backend.js";
import { runTool, toolSpecs, type AgentTool } from "./tools.js";

export type LoopOutcome =
  | { kind: "fix"; source: string; rationale: string }
  | { kind: "question"; text: string }
  | { kind: "diagnosis"; text: string }
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
    };

export type LoopStep =
  | { kind: "thinking" }
  | { kind: "tool"; name: string; ok: boolean; detail: string }
  | { kind: "candidate"; passed: boolean; detail: string }
  | { kind: "unusable"; detail: string };

export interface LoopDeps {
  engine: ChatEngine;
  model?: string;
  tools: AgentTool[];
  system: string;
  /** What the user reported, in their words. */
  task: string;
  /** Compile + replay the candidate. The loop cannot succeed without this passing. */
  verify: (candidate: string) => Promise<{ passed: boolean; detail: string }>;
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

export async function runAgentLoop(deps: LoopDeps): Promise<LoopOutcome> {
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const messages: ChatMessage[] = [
    { role: "system", content: deps.system },
    { role: "user", content: deps.task },
  ];
  let lastAttempt: string | undefined;
  // Counted so `exhausted.reason` can say WHAT went wrong, not just that it did — a watcher on
  // `onStep` otherwise sees only "thinking" repeated and a person debugging the agent (not the
  // app) has nothing to go on.
  let failedCandidates = 0;
  let unusableReplies = 0;

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
      return { kind: "question", text: head.slice(ASK.length).split(/^```/m)[0]!.trim() };
    }
    if (head.startsWith(NOT_IN_APP)) {
      return { kind: "diagnosis", text: head.slice(NOT_IN_APP.length).split(/^```/m)[0]!.trim() };
    }

    const candidate = extractSource(text);
    if (!looksLikeApp(candidate)) {
      unusableReplies += 1;
      deps.onStep?.({ kind: "unusable", detail: text.trim() || "(empty reply)" });
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "user",
        content: `That was not an app. Reply with the complete .app.ts in one \`\`\`ts block, or "${ASK} <question>", or "${NOT_IN_APP} <what is wrong outside the app>".`,
      });
      continue;
    }

    lastAttempt = candidate;
    const verdict = await deps.verify(candidate);
    deps.onStep?.({ kind: "candidate", passed: verdict.passed, detail: verdict.detail });
    if (verdict.passed) {
      // THE RULE: this is the only path in the entire function that returns `kind: "fix"`, and it
      // is reachable only after `deps.verify` — the user's own recorded case, replayed — passed.
      return { kind: "fix", source: candidate, rationale: text.split("```")[0]!.trim() };
    }
    failedCandidates += 1;
    // The one sentence the model never hears today.
    messages.push({ role: "assistant", content: text });
    messages.push({
      role: "user",
      content: `Your change did NOT fix it. Replaying what the user did still gives:\n${verdict.detail}\nDo not send the same edit again. Investigate with the tools, then either fix it, ask, or say it is not the app's fault.`,
    });
  }

  // A stop that lands on the loop's LAST step (model reply arrives after abort, or fails verify
  // right as the budget runs out) must still read as "stopped", not "exhausted" — a late stop is
  // exactly when a user is most likely to hit the button.
  if (deps.signal?.aborted) return stopped();
  return {
    kind: "exhausted",
    reason: `gave up after ${maxSteps} steps (${failedCandidates} candidate${failedCandidates === 1 ? "" : "s"} failed replay, ${unusableReplies} repl${unusableReplies === 1 ? "y was" : "ies were"} not an app)`,
    ...(lastAttempt ? { lastAttempt } : {}),
  };
}
