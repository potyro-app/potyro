// What the replay found, in the user's terms. Their expectation leads, because that is the question
// being answered — the steps are the evidence, not the headline.

import type { ReplayReport } from "@potyro/runtime";

export function CaseReport({
  report,
  lostSteps,
  onClose,
}: {
  report: ReplayReport;
  /** Steps the recorder dropped while capturing this case (CaseRecorder.lost, App.tsx). Shown as a
   *  plain warning when non-zero: a report that otherwise reads clean below it must not be mistaken
   *  for proof the whole path was captured. */
  lostSteps?: number;
  onClose: () => void;
}) {
  return (
    <div className="k-case-report" role="dialog" aria-label="What happened">
      <h3>{report.title || "What happened"}</h3>
      {lostSteps ? (
        <p className="k-case-lost">
          Part of this recording was lost — {lostSteps} step{lostSteps === 1 ? "" : "s"} could not be captured.
        </p>
      ) : null}
      {report.expectation ? <p className="k-case-expect">You expected: {report.expectation}</p> : null}
      <ol>
        {report.outcomes.map((o, i) =>
          // An `expect` step is the user's own words, not a check the replay ran — it can't fail,
          // so marking it ✓/✗ next to steps that genuinely can reads as "your expectation was met"
          // (it already leads the report above). Neutral marker, no data-ok: nothing here claims a
          // pass or a fail.
          o.step.kind === "expect" ? (
            <li key={i} className="k-case-step">
              · {o.detail}
            </li>
          ) : (
            <li key={i} className="k-case-step" data-ok={o.ok}>
              {o.ok ? "✓" : "✗"} {o.detail}
            </li>
          ),
        )}
      </ol>
      <button type="button" className="k-add" onClick={onClose}>Close</button>
    </div>
  );
}
