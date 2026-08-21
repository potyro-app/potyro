// Watch the fixing agent work, and stop it — the surface for `startFix` (start-fix.ts). Everything
// before this was built and tested but never rendered: this is what a person actually sees while an
// agent investigates a case they reported, and what they're shown once it's done.
//
// The step feed is `LoopStep[]` as it happened, oldest first — thinking, a tool call and whether it
// succeeded, a candidate and whether it passed replay, a reply that wasn't usable. `outcome` is
// undefined while the loop is still running (there is a Stop button and nothing else to show yet)
// and one of `LoopOutcome`'s six shapes once it finishes.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE: only `kind: "fix"` ever gets an Apply button, wired to
// `outcome.source` — the one candidate that has actually replayed the user's own case and passed
// (loop.ts). `lastAttempt` on `stopped`/`exhausted` is a candidate that FAILED replay; both
// `LoopOutcome`'s own doc comments say show it, never apply it. Offering Apply on either would hand
// someone an unverified fix — exactly what the verify-before-claiming-fixed loop exists to prevent.
// `unverifiedAttempt` below is the ONLY place `lastAttempt` is rendered, and it renders no button.

import { useState } from "react";
import type { LoopOutcome, LoopStep } from "@karta/generator/agent";

export interface FixPanelProps {
  /** `undefined` while the loop is still running; one of six shapes once it's done. */
  outcome?: LoopOutcome;
  /** The live feed, oldest first — appended to as `startFix`'s `onStep` fires. */
  steps: LoopStep[];
  /** Called with `fix.source` ONLY — see the file header. */
  onApply: (source: string) => void;
  /** Called with the person's typed reply to a `question` outcome. */
  onAnswer: (text: string) => void;
  /** Wired to the `AbortController` driving `startFix`. */
  onStop: () => void;
  onClose: () => void;
}

function stepLine(step: LoopStep, i: number) {
  if (step.kind === "thinking") {
    return (
      <li key={i} className="k-fix-step" data-kind="thinking">
        …thinking
      </li>
    );
  }
  if (step.kind === "tool") {
    return (
      <li key={i} className="k-fix-step" data-kind="tool" data-ok={step.ok}>
        {step.ok ? "✓" : "✗"} {step.name} — {step.detail}
      </li>
    );
  }
  if (step.kind === "candidate") {
    return (
      <li key={i} className="k-fix-step" data-kind="candidate" data-ok={step.passed}>
        {step.passed ? "✓" : "✗"} candidate {step.passed ? "passed" : "failed"} replay — {step.detail}
      </li>
    );
  }
  // "unusable": the model's reply was neither an app, a question, nor a diagnosis marker.
  return (
    <li key={i} className="k-fix-step" data-kind="unusable">
      ✗ not usable — {step.detail}
    </li>
  );
}

/** `lastAttempt` on `stopped`/`exhausted`: shown for reference, never offered to apply. The only
 *  place either outcome's candidate reaches the screen. */
function unverifiedAttempt(source: string) {
  return (
    <details className="k-fix-lastattempt">
      <summary>Last thing it tried (did not pass replay — not applied)</summary>
      <pre>{source}</pre>
    </details>
  );
}

function FixOutcome({
  outcome,
  onApply,
  onAnswer,
}: {
  outcome: LoopOutcome;
  onApply: (source: string) => void;
  onAnswer: (text: string) => void;
}) {
  const [reply, setReply] = useState("");

  if (outcome.kind === "fix") {
    return (
      <div className="k-fix-outcome k-fix-fix" data-kind="fix">
        <p className="k-fix-outcome-head">Fix found</p>
        <p className="k-fix-rationale">{outcome.rationale}</p>
        <button type="button" className="k-add k-primary-action" onClick={() => onApply(outcome.source)}>
          Apply
        </button>
      </div>
    );
  }

  if (outcome.kind === "question") {
    return (
      <div className="k-fix-outcome k-fix-question" data-kind="question">
        <p className="k-fix-outcome-head">It has a question</p>
        <p>{outcome.text}</p>
        <textarea
          className="k-input"
          aria-label="Your answer"
          rows={3}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
        />
        <button
          type="button"
          className="k-add k-primary-action"
          disabled={!reply.trim()}
          onClick={() => onAnswer(reply.trim())}
        >
          Send answer
        </button>
      </div>
    );
  }

  if (outcome.kind === "refused") {
    // Nothing was investigated, and it is not a statement about the app — a missing key, an engine
    // that cannot drive a tool loop, a recording with nothing to work from. This MUST NOT wear the
    // `diagnosis` heading: "This one isn't in your app" told someone their app was fine when the
    // real answer was "you never wrote down what you expected".
    return (
      <div className="k-fix-outcome k-fix-refused" data-kind="refused" role="note">
        <p className="k-fix-outcome-head">Nothing to investigate yet</p>
        <p>{outcome.text}</p>
      </div>
    );
  }

  if (outcome.kind === "diagnosis") {
    // Deliberately not styled as an error — nothing failed, the fault is just outside the app.
    return (
      <div className="k-fix-outcome k-fix-diagnosis" data-kind="diagnosis" role="note">
        <p className="k-fix-outcome-head">This one isn&rsquo;t in your app</p>
        <p>{outcome.text}</p>
      </div>
    );
  }

  if (outcome.kind === "no-repro") {
    // NOT a failure and NOT a fix — the recorded path currently succeeds against the app as it is.
    return (
      <div className="k-fix-outcome k-fix-norepro" data-kind="no-repro" role="note">
        <p className="k-fix-outcome-head">Could not reproduce this</p>
        <p>It replayed clean against the app as it is — {outcome.detail}</p>
      </div>
    );
  }

  if (outcome.kind === "stopped") {
    // The person ended it — this must not read as the agent failing.
    return (
      <div className="k-fix-outcome k-fix-stopped" data-kind="stopped" role="note">
        <p className="k-fix-outcome-head">Stopped</p>
        <p>You ended this before it finished.</p>
        {outcome.lastAttempt ? unverifiedAttempt(outcome.lastAttempt) : null}
      </div>
    );
  }

  // "exhausted": it gave up. `reason` carries the real cause.
  return (
    <div className="k-fix-outcome k-fix-exhausted" data-kind="exhausted" role="note">
      <p className="k-fix-outcome-head">Gave up</p>
      <p>{outcome.reason}</p>
      {outcome.lastAttempt ? unverifiedAttempt(outcome.lastAttempt) : null}
    </div>
  );
}

export function FixPanel({ outcome, steps, onApply, onAnswer, onStop, onClose }: FixPanelProps) {
  const running = outcome === undefined;

  return (
    <div className="k-fix-panel" role="dialog" aria-label="Fix this">
      <h3>{running ? "Investigating…" : "Investigation finished"}</h3>

      <ol className="k-fix-steps">{steps.map((s, i) => stepLine(s, i))}</ol>

      {running ? (
        <button type="button" className="k-add" onClick={onStop}>
          Stop
        </button>
      ) : (
        <FixOutcome outcome={outcome} onApply={onApply} onAnswer={onAnswer} />
      )}

      <button type="button" className="k-add" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
